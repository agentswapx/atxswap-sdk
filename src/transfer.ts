import type { PublicClient, Address } from "viem";
import { erc20Abi } from "./abi/index.js";
import type { ContractAddresses, UnlockedWallet, TxResult } from "./types.js";

export class TransferService {
  constructor(
    private readonly client: PublicClient,
    private readonly contracts: ContractAddresses,
  ) {}

  async sendBnb(wallet: UnlockedWallet, to: Address, amount: bigint): Promise<TxResult> {
    const txHash = await wallet.walletClient.sendTransaction({
      chain: wallet.chain,
      account: wallet.account,
      to,
      value: amount,
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`BNB transfer reverted: ${txHash}`);
    }

    return { txHash };
  }

  async sendToken(
    wallet: UnlockedWallet,
    tokenAddress: Address,
    to: Address,
    amount: bigint,
  ): Promise<TxResult> {
    const txHash = await wallet.walletClient.writeContract({
      chain: wallet.chain,
      account: wallet.account,
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    });

    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`Token transfer reverted: ${txHash}`);
    }

    return { txHash };
  }

  async sendAtx(wallet: UnlockedWallet, to: Address, amount: bigint): Promise<TxResult> {
    return this.sendToken(wallet, this.contracts.atx, to, amount);
  }

  async sendUsdt(wallet: UnlockedWallet, to: Address, amount: bigint): Promise<TxResult> {
    return this.sendToken(wallet, this.contracts.usdt, to, amount);
  }
}
