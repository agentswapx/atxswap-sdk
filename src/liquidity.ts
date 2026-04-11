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
  TxResult,
  SwapResult,
} from "./types.js";

const MIN_TICK = -887200;
const MAX_TICK = 887200;

export class LiquidityService {
  constructor(
    private readonly client: PublicClient,
    private readonly contracts: ContractAddresses,
    private readonly poolFee: number,
  ) {}

  async addLiquidity(
    wallet: UnlockedWallet,
    atxAmount: bigint,
    usdtAmount: bigint,
    options?: LiquidityAddOptions,
  ): Promise<SwapResult> {
    const token0 = await this.client.readContract({
      address: this.contracts.pool,
      abi: poolAbi,
      functionName: "token0",
    });
    const isAtxToken0 =
      (token0 as Address).toLowerCase() === this.contracts.atx.toLowerCase();

    const amount0Desired = isAtxToken0 ? atxAmount : usdtAmount;
    const amount1Desired = isAtxToken0 ? usdtAmount : atxAmount;

    let tickLower: number;
    let tickUpper: number;
    if (options?.fullRange !== false && !options?.tickLower && !options?.tickUpper) {
      tickLower = MIN_TICK;
      tickUpper = MAX_TICK;
    } else {
      tickLower = options?.tickLower ?? MIN_TICK;
      tickUpper = options?.tickUpper ?? MAX_TICK;
    }

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
          tickLower,
          tickUpper,
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
}
