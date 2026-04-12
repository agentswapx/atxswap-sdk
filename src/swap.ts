import type { PublicClient, Address } from "viem";
import { maxUint256 } from "viem";
import { erc20Abi, swapRouterAbi, quoterAbi } from "./abi/index.js";
import { DEFAULT_SLIPPAGE_BPS, DEADLINE_SECONDS } from "./constants.js";
import type { ContractAddresses, UnlockedWallet, SwapResult, QuoteResult } from "./types.js";

export class SwapService {
  constructor(
    private readonly client: PublicClient,
    private readonly contracts: ContractAddresses,
    private readonly poolFee: number,
  ) {}

  async preview(direction: "buy" | "sell", amount: bigint): Promise<QuoteResult> {
    const isBuy = direction === "buy";
    const tokenIn = isBuy ? this.contracts.usdt : this.contracts.atx;
    const tokenOut = isBuy ? this.contracts.atx : this.contracts.usdt;

    const result = await this.client.simulateContract({
      address: this.contracts.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn: amount, fee: this.poolFee, sqrtPriceLimitX96: 0n }],
    });

    const amountOut = result.result[0];

    const effectivePrice = Number(isBuy ? amount : amountOut) / Number(isBuy ? amountOut : amount);
    const idealPrice = Number(amount) / Number(amountOut);
    const priceImpact = Math.abs(effectivePrice - idealPrice) / idealPrice;

    return { direction, amountIn: amount, amountOut, priceImpact };
  }

  async buy(wallet: UnlockedWallet, usdtAmount: bigint, slippageBps?: number): Promise<SwapResult> {
    return this.executeSwap(wallet, "buy", usdtAmount, slippageBps);
  }

  async sell(wallet: UnlockedWallet, atxAmount: bigint, slippageBps?: number): Promise<SwapResult> {
    return this.executeSwap(wallet, "sell", atxAmount, slippageBps);
  }

  private async executeSwap(
    wallet: UnlockedWallet,
    direction: "buy" | "sell",
    amountIn: bigint,
    slippageBps?: number,
  ): Promise<SwapResult> {
    const isBuy = direction === "buy";
    const tokenIn = isBuy ? this.contracts.usdt : this.contracts.atx;
    const tokenOut = isBuy ? this.contracts.atx : this.contracts.usdt;
    const slippage = BigInt(slippageBps ?? DEFAULT_SLIPPAGE_BPS);

    // 1. Get quote
    const quoteResult = await this.client.simulateContract({
      address: this.contracts.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: this.poolFee, sqrtPriceLimitX96: 0n }],
    });
    const expectedOut = quoteResult.result[0];
    const amountOutMinimum = expectedOut - (expectedOut * slippage) / 10000n;

    // 2. Check and handle approval
    await this.ensureApproval(wallet, tokenIn, this.contracts.swapRouter, amountIn);

    // 3. Execute swap
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
    const txHash = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: this.contracts.swapRouter,
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: this.poolFee,
          recipient: wallet.address,
          amountIn,
          amountOutMinimum: amountOutMinimum > 0n ? amountOutMinimum : 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`Swap transaction reverted: ${txHash}`);
    }

    return { txHash, amountIn, amountOut: expectedOut };
  }

  private async ensureApproval(
    wallet: UnlockedWallet,
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<void> {
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
