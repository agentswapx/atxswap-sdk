import type { Address } from "viem";

export const BSC_CHAIN_ID = 56;

export const DEFAULT_RPC_URL = "https://bsc-rpc.publicnode.com";

export const DEFAULT_CONTRACTS = {
  atx: "0xC834d7D575A88c2C81DC1216A693B77aC6483Fca" as Address,
  usdt: "0x55d398326f99059fF775485246999027B3197955" as Address,
  pool: "0x09aecd2448b99fc913b781cbc660acbab227939b" as Address,
  swapRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" as Address,
  quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address,
  npm: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address,
} as const;

export const DEFAULT_POOL_FEE = 2500;

export const DEFAULT_SLIPPAGE_BPS = 300; // 3%

export const MAX_UINT128 = (1n << 128n) - 1n;

export const DEADLINE_SECONDS = 1200; // 20 minutes
