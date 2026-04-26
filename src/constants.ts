import type { Address } from "viem";

export const BSC_CHAIN_ID = 56;

export const DEFAULT_RPC_URLS: readonly string[] = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
  "https://bsc-dataseed3.bnbchain.org",
  "https://bsc-dataseed4.bnbchain.org",
  "https://binance.nodereal.io",
];

export const DEFAULT_RPC_URL = DEFAULT_RPC_URLS[0];

export const DEFAULT_CONTRACTS = {
  atx: "0x31bD373bDde9e65Ff681d2970b4b01B8b2C750e0" as Address,
  usdt: "0x55d398326f99059fF775485246999027B3197955" as Address,
  pool: "0xC3Bd1991332308da3c3571c334941f3398FD91B6" as Address,
  swapRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" as Address,
  quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address,
  npm: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address,
} as const;

export const DEFAULT_POOL_FEE = 2500;

export const DEFAULT_SLIPPAGE_BPS = 100; // 1%

export const MAX_UINT128 = (1n << 128n) - 1n;

export const DEADLINE_SECONDS = 1200; // 20 minutes
