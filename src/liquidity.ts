import type { PublicClient, Address } from "viem";
import { encodeFunctionData, maxUint256 } from "viem";
import { erc20Abi, npmAbi, poolAbi } from "./abi/index.js";
import {
  DEFAULT_SLIPPAGE_BPS,
  DEADLINE_SECONDS,
  MAX_UINT128,
} from "./constants.js";
import type {
  ContractAddresses,
  UnlockedWallet,
  LiquidityAddOptions,
  QuoteAddLiquidityOptions,
  QuoteAddLiquidityResult,
  TxResult,
  SwapResult,
} from "./types.js";

const MIN_TICK = -887200;
const MAX_TICK = 887200;
const Q96 = 2n ** 96n;
const LOG_BASE = Math.log(1.0001);

type PoolContext = {
  isAtxToken0: boolean;
  sqrtPriceX96: bigint;
  currentTick: number;
  tickSpacing: number;
  usdtPerAtx: number;
};

type ResolvedRange = QuoteAddLiquidityResult["range"];

function feeToTickSpacing(fee: number): number {
  switch (fee) {
    case 100:
      return 1;
    case 500:
      return 10;
    case 2500:
      return 50;
    case 10000:
      return 200;
    default:
      return 50;
  }
}

function priceToTick(price: number): number {
  if (price <= 0) return 0;
  return Math.round(Math.log(price) / LOG_BASE);
}

function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

function tickToSqrtPriceX96(tick: number): bigint {
  const sqrtPrice = Math.sqrt(1.0001 ** tick);
  return BigInt(Math.round(sqrtPrice * Number(Q96)));
}

function sqrtPriceX96ToRawPrice(sqrtPriceX96: bigint): number {
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return sqrtP * sqrtP;
}

function clampAndOrderTicks(tickLower: number, tickUpper: number, tickSpacing: number): {
  tickLower: number;
  tickUpper: number;
} {
  let lower = Math.min(tickLower, tickUpper);
  let upper = Math.max(tickLower, tickUpper);
  if (lower < MIN_TICK) lower = MIN_TICK;
  if (upper > MAX_TICK) upper = MAX_TICK;
  if (lower >= upper) {
    upper = lower + tickSpacing;
  }
  if (upper > MAX_TICK) {
    upper = MAX_TICK;
    lower = upper - tickSpacing;
  }
  return { tickLower: lower, tickUpper: upper };
}

function humanUsdtPerAtxToToken1OverToken0(humanPrice: number, isAtxToken0: boolean): number {
  if (humanPrice <= 0) {
    throw new Error("Human price must be positive");
  }
  return isAtxToken0 ? humanPrice : 1 / humanPrice;
}

function humanPriceRangeToTicks(
  minHumanPrice: number,
  maxHumanPrice: number,
  isAtxToken0: boolean,
  tickSpacing: number,
): { tickLower: number; tickUpper: number } {
  const rawA = humanUsdtPerAtxToToken1OverToken0(minHumanPrice, isAtxToken0);
  const rawB = humanUsdtPerAtxToToken1OverToken0(maxHumanPrice, isAtxToken0);
  return clampAndOrderTicks(
    nearestUsableTick(priceToTick(rawA), tickSpacing),
    nearestUsableTick(priceToTick(rawB), tickSpacing),
    tickSpacing,
  );
}

function neededTokens(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
): { need0: boolean; need1: boolean } {
  const sqrtA = tickToSqrtPriceX96(tickLower);
  const sqrtB = tickToSqrtPriceX96(tickUpper);
  if (sqrtPriceX96 <= sqrtA) return { need0: true, need1: false };
  if (sqrtPriceX96 >= sqrtB) return { need0: false, need1: true };
  return { need0: true, need1: true };
}

function calcOtherAmount(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount: bigint,
  isAmount0: boolean,
): bigint {
  if (amount === 0n) return 0n;

  const sqrtA = tickToSqrtPriceX96(tickLower);
  const sqrtB = tickToSqrtPriceX96(tickUpper);
  const sqrtP = sqrtPriceX96;

  if (sqrtP <= sqrtA || sqrtP >= sqrtB) {
    return 0n;
  }

  if (isAmount0) {
    const numeratorL = amount * sqrtP * sqrtB;
    const denominatorL = (sqrtB - sqrtP) * Q96;
    if (denominatorL === 0n) return 0n;
    const liquidity = numeratorL / denominatorL;
    const amount1 = (liquidity * (sqrtP - sqrtA)) / Q96;
    return amount1 > 0n ? amount1 : 0n;
  }

  const diffPA = sqrtP - sqrtA;
  if (diffPA === 0n) return 0n;
  const liquidity = (amount * Q96) / diffPA;
  const amount0 = (liquidity * (sqrtB - sqrtP) * Q96) / (sqrtP * sqrtB);
  return amount0 > 0n ? amount0 : 0n;
}

export class LiquidityService {
  constructor(
    private readonly client: PublicClient,
    private readonly contracts: ContractAddresses,
    private readonly poolFee: number,
  ) {}

  async quoteAddLiquidity(
    options: QuoteAddLiquidityOptions,
  ): Promise<QuoteAddLiquidityResult> {
    if (options.amount <= 0n) {
      throw new Error("Amount must be greater than 0");
    }

    const pool = await this.getPoolContext();
    const range = this.resolveRange(pool, options.range);
    const { need0, need1 } = neededTokens(
      pool.sqrtPriceX96,
      range.tickLower,
      range.tickUpper,
    );
    const needs = {
      atx: pool.isAtxToken0 ? need0 : need1,
      usdt: pool.isAtxToken0 ? need1 : need0,
    };

    let atxAmount = 0n;
    let usdtAmount = 0n;

    if (options.baseToken === "atx") {
      if (!needs.atx && needs.usdt) {
        throw new Error("Current price is above the selected range; only USDT is needed");
      }
      atxAmount = options.amount;
      usdtAmount = needs.usdt
        ? calcOtherAmount(
            pool.sqrtPriceX96,
            range.tickLower,
            range.tickUpper,
            options.amount,
            pool.isAtxToken0,
          )
        : 0n;
    } else {
      if (!needs.usdt && needs.atx) {
        throw new Error("Current price is below the selected range; only ATX is needed");
      }
      usdtAmount = options.amount;
      atxAmount = needs.atx
        ? calcOtherAmount(
            pool.sqrtPriceX96,
            range.tickLower,
            range.tickUpper,
            options.amount,
            !pool.isAtxToken0,
          )
        : 0n;
    }

    const slippage = BigInt(options.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    return {
      baseToken: options.baseToken,
      amount: options.amount,
      currentPrice: {
        usdtPerAtx: pool.usdtPerAtx,
        atxPerUsdt: pool.usdtPerAtx === 0 ? 0 : 1 / pool.usdtPerAtx,
        sqrtPriceX96: pool.sqrtPriceX96,
      },
      pool: {
        isAtxToken0: pool.isAtxToken0,
        currentTick: pool.currentTick,
        tickSpacing: pool.tickSpacing,
      },
      range,
      needs,
      desiredAmounts: {
        atx: atxAmount,
        usdt: usdtAmount,
      },
      minAmounts: {
        atx: atxAmount - (atxAmount * slippage) / 10000n,
        usdt: usdtAmount - (usdtAmount * slippage) / 10000n,
      },
    };
  }

  async addLiquidity(
    wallet: UnlockedWallet,
    atxAmount: bigint,
    usdtAmount: bigint,
    options?: LiquidityAddOptions,
  ): Promise<SwapResult> {
    const pool = await this.getPoolContext();
    const isAtxToken0 = pool.isAtxToken0;

    const amount0Desired = isAtxToken0 ? atxAmount : usdtAmount;
    const amount1Desired = isAtxToken0 ? usdtAmount : atxAmount;
    const range = this.resolveAddRange(pool.tickSpacing, options);

    const slippage = BigInt(options?.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const amount0Min = amount0Desired - (amount0Desired * slippage) / 10000n;
    const amount1Min = amount1Desired - (amount1Desired * slippage) / 10000n;

    // Ensure approvals for both tokens
    await Promise.all([
      this.ensureApproval(wallet, this.contracts.atx, this.contracts.npm, atxAmount),
      this.ensureApproval(wallet, this.contracts.usdt, this.contracts.npm, usdtAmount),
    ]);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const txHash = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: this.contracts.npm,
      abi: npmAbi,
      functionName: "mint",
      args: [
        {
          token0: isAtxToken0 ? this.contracts.atx : this.contracts.usdt,
          token1: isAtxToken0 ? this.contracts.usdt : this.contracts.atx,
          fee: this.poolFee,
          tickLower: range.tickLower,
          tickUpper: range.tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min: amount0Min > 0n ? amount0Min : 0n,
          amount1Min: amount1Min > 0n ? amount1Min : 0n,
          recipient: wallet.address,
          deadline,
        },
      ],
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`Add liquidity transaction reverted: ${txHash}`);
    }

    return { txHash, amountIn: amount0Desired, amountOut: amount1Desired };
  }

  async removeLiquidity(
    wallet: UnlockedWallet,
    tokenId: bigint,
    percent: number,
  ): Promise<TxResult> {
    if (percent < 1 || percent > 100) {
      throw new Error("Percent must be between 1 and 100");
    }

    const positionData = await this.client.readContract({
      address: this.contracts.npm,
      abi: npmAbi,
      functionName: "positions",
      args: [tokenId],
    });
    const liquidity = positionData[7] as bigint;
    const liquidityToRemove = (liquidity * BigInt(percent)) / 100n;

    if (liquidityToRemove === 0n) {
      throw new Error("No liquidity to remove");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const calls: `0x${string}`[] = [
      encodeFunctionData({
        abi: npmAbi,
        functionName: "decreaseLiquidity",
        args: [
          {
            tokenId,
            liquidity: liquidityToRemove,
            amount0Min: 0n,
            amount1Min: 0n,
            deadline,
          },
        ],
      }),
      encodeFunctionData({
        abi: npmAbi,
        functionName: "collect",
        args: [
          {
            tokenId,
            recipient: wallet.address,
            amount0Max: MAX_UINT128,
            amount1Max: MAX_UINT128,
          },
        ],
      }),
    ];

    if (percent === 100) {
      calls.push(
        encodeFunctionData({
          abi: npmAbi,
          functionName: "burn",
          args: [tokenId],
        }),
      );
    }

    const txHash = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: this.contracts.npm,
      abi: npmAbi,
      functionName: "multicall",
      args: [calls],
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`Remove liquidity transaction reverted: ${txHash}`);
    }

    return { txHash };
  }

  async collectFees(wallet: UnlockedWallet, tokenId: bigint): Promise<TxResult> {
    const txHash = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: this.contracts.npm,
      abi: npmAbi,
      functionName: "collect",
      args: [
        {
          tokenId,
          recipient: wallet.address,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        },
      ],
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`Collect fees transaction reverted: ${txHash}`);
    }

    return { txHash };
  }

  async burnPosition(wallet: UnlockedWallet, tokenId: bigint): Promise<TxResult> {
    const txHash = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: this.contracts.npm,
      abi: npmAbi,
      functionName: "burn",
      args: [tokenId],
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`Burn position transaction reverted: ${txHash}`);
    }

    return { txHash };
  }

  private async ensureApproval(
    wallet: UnlockedWallet,
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<void> {
    if (amount === 0n) return;

    const allowance = await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet.address, spender],
    });

    if ((allowance as bigint) >= amount) return;

    const approveTx = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, maxUint256],
    });

    await this.client.waitForTransactionReceipt({ hash: approveTx });
  }

  private async getPoolContext(): Promise<PoolContext> {
    const [token0, slot0] = await Promise.all([
      this.client.readContract({
        address: this.contracts.pool,
        abi: poolAbi,
        functionName: "token0",
      }),
      this.client.readContract({
        address: this.contracts.pool,
        abi: poolAbi,
        functionName: "slot0",
      }),
    ]);

    const isAtxToken0 =
      (token0 as Address).toLowerCase() === this.contracts.atx.toLowerCase();
    const sqrtPriceX96 = slot0[0] as bigint;
    const rawPrice = sqrtPriceX96ToRawPrice(sqrtPriceX96);
    const usdtPerAtx = isAtxToken0 ? rawPrice : rawPrice === 0 ? 0 : 1 / rawPrice;

    return {
      isAtxToken0,
      sqrtPriceX96,
      currentTick: Number(slot0[1]),
      tickSpacing: feeToTickSpacing(this.poolFee),
      usdtPerAtx,
    };
  }

  private resolveAddRange(
    tickSpacing: number,
    options?: LiquidityAddOptions,
  ): { tickLower: number; tickUpper: number } {
    if (options?.fullRange !== false && options?.tickLower === undefined && options?.tickUpper === undefined) {
      return { tickLower: MIN_TICK, tickUpper: MAX_TICK };
    }
    return clampAndOrderTicks(
      options?.tickLower ?? MIN_TICK,
      options?.tickUpper ?? MAX_TICK,
      tickSpacing,
    );
  }

  private resolveRange(
    pool: PoolContext,
    range?: QuoteAddLiquidityOptions["range"],
  ): ResolvedRange {
    if (!range || ("fullRange" in range && range.fullRange)) {
      return {
        mode: "fullRange",
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
      };
    }

    if ("rangePercent" in range) {
      if (!Number.isFinite(range.rangePercent) || range.rangePercent <= 0) {
        throw new Error("rangePercent must be a positive number");
      }
      const factor = range.rangePercent / 100;
      const minPrice = pool.usdtPerAtx * (1 - factor);
      const maxPrice = pool.usdtPerAtx * (1 + factor);
      if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice <= 0) {
        throw new Error("rangePercent is too large for the current price");
      }
      const ticks = humanPriceRangeToTicks(
        minPrice,
        maxPrice,
        pool.isAtxToken0,
        pool.tickSpacing,
      );
      return {
        mode: "percent",
        centerPrice: pool.usdtPerAtx,
        rangePercent: range.rangePercent,
        minPrice,
        maxPrice,
        ...ticks,
      };
    }

    if ("minPrice" in range || "maxPrice" in range) {
      if (!("minPrice" in range) || !("maxPrice" in range)) {
        throw new Error("Both minPrice and maxPrice are required");
      }
      if (!Number.isFinite(range.minPrice) || !Number.isFinite(range.maxPrice) || range.minPrice <= 0 || range.maxPrice <= 0) {
        throw new Error("minPrice and maxPrice must be positive numbers");
      }
      const ticks = humanPriceRangeToTicks(
        range.minPrice,
        range.maxPrice,
        pool.isAtxToken0,
        pool.tickSpacing,
      );
      return {
        mode: "price",
        minPrice: range.minPrice,
        maxPrice: range.maxPrice,
        ...ticks,
      };
    }

    if (!("tickLower" in range) || !("tickUpper" in range)) {
      throw new Error("Both tickLower and tickUpper are required");
    }

    const ticks = clampAndOrderTicks(range.tickLower, range.tickUpper, pool.tickSpacing);
    return {
      mode: "tick",
      ...ticks,
    };
  }
}
