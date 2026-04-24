import type { Address, WalletClient, Chain, Account } from "viem";

export interface ContractAddresses {
  atx: Address;
  usdt: Address;
  pool: Address;
  swapRouter: Address;
  quoter: Address;
  npm: Address;
}

export interface AtxClientConfig {
  rpcUrl?: string;
  rpcUrls?: string[];
  keystorePath?: string;
  contracts?: Partial<ContractAddresses>;
  poolFee?: number;
}

export interface WalletCreateOptions {
  savePassword?: boolean;
}

export interface UnlockedWallet {
  address: Address;
  walletClient: WalletClient;
  account: Account;
  chain: Chain;
}

export interface KeystoreInfo {
  address: Address;
  name?: string;
  filename: string;
}

export interface KeystoreFile {
  version: 3;
  address: string;
  name?: string;
  crypto: {
    cipher: string;
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: string;
    kdfparams: { dklen: number; n: number; r: number; p: number; salt: string };
    mac: string;
  };
}

export interface PriceResult {
  atxPerUsdt: number;
  usdtPerAtx: number;
  sqrtPriceX96: bigint;
}

export interface BalanceResult {
  bnb: bigint;
  atx: bigint;
  usdt: bigint;
}

export interface QuoteResult {
  direction: "buy" | "sell";
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
}

export interface PositionData {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

export interface TokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export interface SwapResult {
  txHash: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
}

export interface LiquidityAddOptions {
  fullRange?: boolean;
  tickLower?: number;
  tickUpper?: number;
  slippageBps?: number;
}

export interface TxResult {
  txHash: `0x${string}`;
}
