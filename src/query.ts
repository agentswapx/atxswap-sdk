import type { PublicClient, Address } from "viem";
import { erc20Abi, quoterAbi, poolAbi, npmAbi } from "./abi/index.js";
import type {
  ContractAddresses,
  PriceResult,
  BalanceResult,
  QuoteResult,
  PositionData,
  TokenInfo,
} from "./types.js";

export class QueryService {
  constructor(
    private readonly client: PublicClient,
    private readonly contracts: ContractAddresses,
    private readonly poolFee: number,
  ) {}

  async getPrice(): Promise<PriceResult> {
    const [slot0Result, token0] = await Promise.all([
      this.client.readContract({
        address: this.contracts.pool,
        abi: poolAbi,
        functionName: "slot0",
      }),
      this.client.readContract({
        address: this.contracts.pool,
        abi: poolAbi,
        functionName: "token0",
      }),
    ]);

    const sqrtPriceX96 = slot0Result[0];
    const isAtxToken0 =
      (token0 as Address).toLowerCase() === this.contracts.atx.toLowerCase();

    const num = Number(sqrtPriceX96);
    const Q96 = Number(2n ** 96n);
    const ratio = (num / Q96) ** 2; // token1/token0

    let usdtPerAtx: number;
    if (isAtxToken0) {
      usdtPerAtx = ratio; // USDT/ATX
    } else {
      usdtPerAtx = ratio === 0 ? 0 : 1 / ratio; // invert
    }

    return {
      atxPerUsdt: usdtPerAtx === 0 ? 0 : 1 / usdtPerAtx,
      usdtPerAtx,
      sqrtPriceX96,
    };
  }

  async getBalance(address: Address): Promise<BalanceResult> {
    const [bnb, atx, usdt] = await Promise.all([
      this.client.getBalance({ address }),
      this.client.readContract({
        address: this.contracts.atx,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
      this.client.readContract({
        address: this.contracts.usdt,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    return { bnb, atx, usdt };
  }

  async getQuote(direction: "buy" | "sell", amount: bigint): Promise<QuoteResult> {
    const isBuy = direction === "buy";
    const tokenIn = isBuy ? this.contracts.usdt : this.contracts.atx;
    const tokenOut = isBuy ? this.contracts.atx : this.contracts.usdt;

    const result = await this.client.simulateContract({
      address: this.contracts.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          amountIn: amount,
          fee: this.poolFee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const amountOut = result.result[0];

    // Estimate price impact by comparing effective price to current price
    const price = await this.getPrice();
    const effectivePrice =
      Number(isBuy ? amount : amountOut) / Number(isBuy ? amountOut : amount);
    const marketPrice = price.usdtPerAtx;
    const priceImpact =
      marketPrice > 0 ? Math.abs(effectivePrice - marketPrice) / marketPrice : 0;

    return {
      direction,
      amountIn: amount,
      amountOut,
      priceImpact,
    };
  }

  async getPositions(address: Address): Promise<PositionData[]> {
    const balance = await this.client.readContract({
      address: this.contracts.npm,
      abi: npmAbi,
      functionName: "balanceOf",
      args: [address],
    });

    const count = Number(balance);
    if (count === 0) return [];

    const tokenIds = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.client.readContract({
          address: this.contracts.npm,
          abi: npmAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [address, BigInt(i)],
        }),
      ),
    );

    const positions = await Promise.all(
      tokenIds.map((tokenId) =>
        this.client.readContract({
          address: this.contracts.npm,
          abi: npmAbi,
          functionName: "positions",
          args: [tokenId],
        }),
      ),
    );

    return positions
      .map((pos, i) => {
        const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] = pos;
        // Filter to only our pool's positions
        const isOurPool =
          ((token0 as Address).toLowerCase() === this.contracts.atx.toLowerCase() ||
            (token1 as Address).toLowerCase() === this.contracts.atx.toLowerCase()) &&
          ((token0 as Address).toLowerCase() === this.contracts.usdt.toLowerCase() ||
            (token1 as Address).toLowerCase() === this.contracts.usdt.toLowerCase());

        if (!isOurPool) return null;

        return {
          tokenId: tokenIds[i],
          token0: token0 as Address,
          token1: token1 as Address,
          fee: Number(fee),
          tickLower: Number(tickLower),
          tickUpper: Number(tickUpper),
          liquidity,
          tokensOwed0,
          tokensOwed1,
        } satisfies PositionData;
      })
      .filter((p): p is PositionData => p !== null);
  }

  async getTokenInfo(tokenAddress: Address): Promise<TokenInfo> {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" }),
      this.client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
      this.client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
      this.client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "totalSupply" }),
    ]);

    return {
      address: tokenAddress,
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
      totalSupply: totalSupply as bigint,
    };
  }
}
