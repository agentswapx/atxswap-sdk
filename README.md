# atxswap-sdk

TypeScript SDK for ATX token on-chain interactions on BSC, including wallet management, price queries, token swaps (PancakeSwap V3), concentrated liquidity management, and transfers.

[**中文文档**](./README.zh.md)

## Tech Stack

- **TypeScript** — strict mode
- **viem** `^2.31` — chain interaction (publicClient / walletClient)
- **tsup** — bundler, outputs both ESM (`index.js`) and CJS (`index.cjs`)
- **Node.js 18+** — runtime requirement (`node:crypto` / `node:fs`)

## Install

```bash
npm install atxswap-sdk
```

```typescript
import { AtxClient } from "atxswap-sdk";

const client = new AtxClient({ rpcUrl: process.env.BSC_RPC_URL });
const price = await client.query.getPrice();
```

> The SDK ships with a built-in fallback list of 8 BSC public RPC endpoints, so you can construct `new AtxClient()` with no config and it will still work. See [`AtxClient`](#atxclient--entry-point) for `rpcUrls` usage.

Need it locally for development?

```bash
git clone https://github.com/agentswapx/atxswap-sdk.git
cd atxswap-sdk
npm install        # builds dist via prepare hook
npm run dev        # watch mode
npm run typecheck
```

## Directory Structure

```
src/
├── index.ts          ← Unified export entry
├── client.ts         ← AtxClient main class, assembles all services
├── types.ts          ← Type definitions (interfaces / config)
├── constants.ts      ← Default contract addresses, RPC, fees, constants
├── wallet.ts         ← WalletManager — keystore encrypted wallet management
├── query.ts          ← QueryService — read-only on-chain queries
├── swap.ts           ← SwapService — token swaps
├── liquidity.ts      ← LiquidityService — V3 liquidity management
├── transfer.ts       ← TransferService — BNB / ERC20 transfers
└── abi/
    ├── index.ts      ← ABI unified export
    ├── erc20.ts      ← ERC20 standard ABI fragments
    ├── swapRouter.ts ← PancakeSwap V3 SwapRouter ABI
    ├── quoter.ts     ← PancakeSwap V3 Quoter ABI
    ├── pool.ts       ← V3 Pool ABI (slot0, token0)
    └── npm.ts        ← NonfungiblePositionManager ABI
```

## Architecture

### AtxClient — Entry Point

`AtxClient` is the single entry point of the SDK. On construction it creates a `publicClient` and instantiates five service modules:

```typescript
const client = new AtxClient({
  // Option A: pass an ordered list, viem will fall back in order
  rpcUrls: [
    "https://my-private-rpc.example.com",
    "https://bsc-rpc.publicnode.com",
  ],
  // Option B (legacy, single endpoint): rpcUrl: "https://..."
  // If neither is set, the built-in DEFAULT_RPC_URLS list is used.
  keystorePath: "./keystore",                 // optional, default ./keystore
  poolFee: 2500,                              // optional, default 2500 (0.25%)
  contracts: {                                // optional, partial override
    atx: "0x...",
    usdt: "0x...",
  },
});
await client.ready(); // Wait for SecretStore initialization
```

`rpcUrls` takes priority over `rpcUrl`. The `publicClient` (reads) and the `walletClient` returned from `wallet.load()` (writes) share the same viem `fallback` transport built from the resolved URL list.

Access modules via `client.wallet` / `client.query` / `client.swap` / `client.liquidity` / `client.transfer`.

### Module Responsibilities

| Module | Class | R/W | Responsibility |
|---|---|---|---|
| `wallet` | `WalletManager` | Local R/W | Create / list / load the single skill wallet, plus `exportKeystore()` to read the encrypted keystore V3 JSON (importing or exporting a raw private key is not supported) |
| `query` | `QueryService` | On-chain read | Price, balance, quote, LP position, token info queries |
| `swap` | `SwapService` | On-chain write | Buy/sell ATX via V3 SwapRouter |
| `liquidity` | `LiquidityService` | On-chain write | Add/remove liquidity, collect fees, burn empty positions |
| `transfer` | `TransferService` | On-chain write | Send BNB / ATX / USDT / any ERC20 |

### Wallet Management (WalletManager)

Private keys are stored in keystore V3 format with encryption parameters:

- KDF: scrypt (N=8192, r=8, p=1)
- Cipher: aes-128-ctr
- MAC: sha256

Each wallet is stored as `{address}.json` in the `keystorePath` directory. `load()` returns an `UnlockedWallet` object containing `walletClient` and `account`, which can be passed directly to other modules' write methods.

### Secure Password Storage (SecretStore)

The SDK includes a built-in cross-platform secure password storage layer — **enter your password once during wallet creation, auto-unlock afterwards**.

#### Platform Strategy

| Platform | Storage Backend | Implementation |
|---|---|---|
| macOS Desktop | Keychain | `security` CLI |
| Linux Desktop (with `DBUS_SESSION_BUS_ADDRESS`) | Secret Service / GNOME Keyring | `secret-tool` CLI |
| Other environments (incl. servers, cron, headless CI) | Master key file | `aes-256-gcm` encrypted local files |

On Linux the SDK only picks `secret-service` when **both** the `secret-tool`
binary is on `PATH` **and** `DBUS_SESSION_BUS_ADDRESS` is set, so cron / SSH /
sandboxed environments fall through to the file backend automatically.

You can also force a backend via `ATXSWAP_SECRET_STORE`:

| Value | Effect |
|---|---|
| `keychain` | macOS Keychain (requires `security` CLI) |
| `secret-service` | libsecret / GNOME Keyring (requires running daemon) |
| `file` | `aes-256-gcm` master-key file backend |
| `none` | No-op store; password is never persisted, caller must pass it on every load |

If the secret backend fails at write time, `WalletManager.create()` still
writes the keystore to disk and returns `{ passwordSaved: false, passwordSaveError }`.
`WalletManager.load(address, password)` swallows save errors silently because
the wallet is already unlocked.

#### Default Paths

| File | Default path |
|---|---|
| `master.key` | `~/.config/atxswap/master.key` |
| `secrets.json` | `~/.config/atxswap/secrets.json` |

These defaults are fixed and cannot be overridden via environment variables.

#### Behavior

- `create()` auto-saves the password on success (disable with `options.savePassword = false`)
- `load(address)` without password auto-reads from SecretStore
- `load(address, password)` with password uses it directly and syncs to storage
- `exportKeystore(address)` returns the on-disk keystore V3 JSON (already password-encrypted); the SDK never exposes the unencrypted private key

#### Additional Methods

| Method | Description |
|---|---|
| `savePassword(address, password)` | Manually save password to secure storage |
| `forgetPassword(address)` | Remove password from secure storage |
| `hasSavedPassword(address)` | Check if a password is saved |
| `loadAuto(address)` | Alias for `load(address)`, pure auto-unlock |

#### File Store Format

For the master key file backend:

- `master.key`: Auto-generated 32-byte random key on first use, permission `600`
- `secrets.json`: Encrypted passwords indexed by address, using `aes-256-gcm`
- `master.key` only encrypts "keystore passwords", does not replace keystore itself

### Swap Flow (SwapService)

Internal flow of `buy()` / `sell()`:

1. Call Quoter for expected output amount
2. Calculate `amountOutMinimum` based on slippage
3. Check allowance, approve `maxUint256` if insufficient
4. Call SwapRouter `exactInputSingle`
5. Wait for transaction confirmation, throw on revert

### Liquidity Management (LiquidityService)

- `addLiquidity()` — Full range by default (tick -887200 ~ 887200), also supports custom tick ranges
- `removeLiquidity()` — Remove by percentage, auto-appends `burn` call at 100%
- `collectFees()` — Collect accumulated fees
- `burnPosition()` — Burn an emptied LP NFT

`removeLiquidity` uses NPM's `multicall` to batch decreaseLiquidity + collect (+ burn) into a single transaction.

## Core Types

```typescript
interface AtxClientConfig {
  rpcUrl?: string;
  keystorePath?: string;
  contracts?: Partial<ContractAddresses>;
  poolFee?: number;
}

interface ContractAddresses {
  atx: Address;
  usdt: Address;
  pool: Address;
  swapRouter: Address;
  quoter: Address;
  npm: Address;
}

interface UnlockedWallet {
  address: Address;
  walletClient: WalletClient;
  account: Account;
  chain: Chain;
}

interface PriceResult { atxPerUsdt: number; usdtPerAtx: number; sqrtPriceX96: bigint; }
interface BalanceResult { bnb: bigint; atx: bigint; usdt: bigint; }
interface QuoteResult { direction: "buy" | "sell"; amountIn: bigint; amountOut: bigint; priceImpact: number; }
interface SwapResult { txHash: `0x${string}`; amountIn: bigint; amountOut: bigint; }
interface TxResult { txHash: `0x${string}`; }
```

## Default Constants

| Constant | Value | Description |
|---|---|---|
| `DEFAULT_RPC_URLS` | `[bsc-rpc.publicnode.com, bsc-dataseed*.bnbchain.org x 6, binance.nodereal.io]` | Built-in BSC RPC fallback list (8 endpoints) |
| `DEFAULT_RPC_URL` | `DEFAULT_RPC_URLS[0]` | First entry of the fallback list (kept for backward compatibility) |
| `DEFAULT_POOL_FEE` | `2500` | 0.25% fee tier |
| `DEFAULT_SLIPPAGE_BPS` | `300` | 3% default slippage |
| `DEADLINE_SECONDS` | `1200` | Transaction deadline 20 minutes |
| `MAX_UINT128` | `2^128 - 1` | Used in collect to claim all fees |

## Usage Examples

### Query Price and Balance

```typescript
import { AtxClient } from "atxswap-sdk";

const client = new AtxClient();

const price = await client.query.getPrice();
console.log(`1 ATX = ${price.usdtPerAtx} USDT`);

const bal = await client.query.getBalance("0x...");
console.log(`BNB: ${bal.bnb}, ATX: ${bal.atx}, USDT: ${bal.usdt}`);
```

### Create Wallet and Swap

```typescript
import { AtxClient, parseUnits } from "atxswap-sdk";

const client = await new AtxClient().ready();

// Create wallet (password auto-saved to secure storage)
const { address } = await client.wallet.create("my-password", "trading-wallet");

// Load later without password
const wallet = await client.wallet.load(address);

// Buy ATX with 10 USDT (1% slippage)
const result = await client.swap.buy(wallet, parseUnits("10", 18), 100);
console.log(`TX: ${result.txHash}`);
```

### Add Liquidity

```typescript
import { AtxClient, parseEther, parseUnits } from "atxswap-sdk";

const client = await new AtxClient().ready();
const wallet = await client.wallet.load("0x...");

const result = await client.liquidity.addLiquidity(
  wallet,
  parseEther("1000"),       // 1000 ATX
  parseUnits("50", 18),     // 50 USDT
  { fullRange: true, slippageBps: 100 },
);
console.log(`TX: ${result.txHash}`);
```

### Transfer

```typescript
import { AtxClient, parseEther } from "atxswap-sdk";

const client = await new AtxClient().ready();
const wallet = await client.wallet.load("0x...");

// Send BNB
await client.transfer.sendBnb(wallet, "0xRecipient", parseEther("0.1"));

// Send ATX
await client.transfer.sendAtx(wallet, "0xRecipient", parseEther("100"));
```

## Exports

The SDK exports via `index.ts`:

- **Classes**: `AtxClient`, `WalletManager`, `QueryService`, `SwapService`, `LiquidityService`, `TransferService`
- **Types**: `ContractAddresses`, `AtxClientConfig`, `SecretStore`, `WalletCreateOptions`, `UnlockedWallet`, `KeystoreInfo`, `KeystoreFile`, `PriceResult`, `BalanceResult`, `QuoteResult`, `PositionData`, `TokenInfo`, `SwapResult`, `LiquidityAddOptions`, `TxResult`
- **Constants**: `BSC_CHAIN_ID`, `DEFAULT_RPC_URLS`, `DEFAULT_RPC_URL`, `DEFAULT_CONTRACTS`, `DEFAULT_POOL_FEE`, `DEFAULT_SLIPPAGE_BPS`, `MAX_UINT128`, `DEADLINE_SECONDS`
- **ABI**: `erc20Abi`, `swapRouterAbi`, `quoterAbi`, `poolAbi`, `npmAbi`
- **viem re-exports**: `parseEther`, `parseUnits`, `formatEther`, `formatUnits`

## Development Guide

### Adding a New Module

1. Create a new service file under `src/` (e.g. `src/staking.ts`)
2. Constructor receives `PublicClient` + `ContractAddresses`, consistent with existing modules
3. Add instance property in `AtxClient` (`client.ts`) and initialize in constructor
4. Export the new class in `index.ts`
5. If new ABI is needed, add it under `src/abi/` and export in `src/abi/index.ts`
6. If new types are needed, define them in `types.ts`

### Adding New Contract Interactions

1. Add required function signatures to the corresponding ABI file
2. Implement the method in the corresponding service
3. Write methods must accept an `UnlockedWallet` parameter
4. After a write transaction, always call `waitForTransactionReceipt` and check `receipt.status`
5. For ERC20 approve, refer to `SwapService.ensureApproval()` implementation

### Notes

- All amounts use `bigint` (18 decimal precision), convert with viem's `parseEther` / `parseUnits`
- Write methods uniformly return `TxResult` or `SwapResult` containing `txHash`
- Transactions that revert throw an `Error`, callers should use try/catch
- ABIs only include actually used function fragments, not the full ABI

## License

MIT
