# atx-agent-sdk

ATX 代币链上交互 TypeScript SDK，封装 BSC 主网上的钱包管理、价格查询、代币交换（PancakeSwap V3）、集中流动性管理和转账功能。

[**English**](./README.md)

## 技术栈

- **TypeScript** — strict 模式
- **viem** `^2.31` — 链交互（publicClient / walletClient）
- **tsup** — 构建工具，同时输出 ESM (`index.js`) 和 CJS (`index.cjs`)
- **Node.js 18+** — 运行时要求（使用 `node:crypto` / `node:fs`）

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/agentswapx/atx-agent-sdk.git
cd atx-agent-sdk

# 安装依赖
npm install

# 构建
npm run build

# 开发模式（watch）
npm run dev

# 类型检查
npm run typecheck
```

## 目录结构

```
src/
├── index.ts          ← 统一导出入口
├── client.ts         ← AtxClient 主类，组装所有服务
├── types.ts          ← 类型定义（接口 / 配置）
├── constants.ts      ← 默认合约地址、RPC、手续费、常量
├── wallet.ts         ← WalletManager — keystore 加密钱包管理
├── query.ts          ← QueryService — 只读链上查询
├── swap.ts           ← SwapService — 代币交换
├── liquidity.ts      ← LiquidityService — V3 流动性管理
├── transfer.ts       ← TransferService — BNB / ERC20 转账
└── abi/
    ├── index.ts      ← ABI 统一导出
    ├── erc20.ts      ← ERC20 标准 ABI 片段
    ├── swapRouter.ts ← PancakeSwap V3 SwapRouter ABI
    ├── quoter.ts     ← PancakeSwap V3 Quoter ABI
    ├── pool.ts       ← V3 Pool ABI（slot0, token0）
    └── npm.ts        ← NonfungiblePositionManager ABI
```

## 架构设计

### AtxClient — 入口类

`AtxClient` 是 SDK 的唯一入口，构造时创建 `publicClient` 并实例化五个服务模块：

```typescript
const client = new AtxClient({
  rpcUrl: "https://bsc-rpc.publicnode.com",  // 可选，有默认值
  keystorePath: "./keystore",                 // 可选，默认 ./keystore
  poolFee: 2500,                              // 可选，默认 2500 (0.25%)
  contracts: {                                // 可选，部分覆盖默认地址
    atx: "0x...",
    usdt: "0x...",
  },
});
await client.ready(); // 等待 SecretStore 初始化完成
```

通过 `client.wallet` / `client.query` / `client.swap` / `client.liquidity` / `client.transfer` 访问各模块。

### 模块职责

| 模块 | 类 | 读/写 | 职责 |
|---|---|---|---|
| `wallet` | `WalletManager` | 读写本地文件 | 创建 / 导入 / 列出 / 加载 / 导出钱包（keystore V3 加密） |
| `query` | `QueryService` | 只读链上 | 价格、余额、报价、LP 仓位、代币信息查询 |
| `swap` | `SwapService` | 写链上 | 通过 V3 SwapRouter 买入/卖出 ATX |
| `liquidity` | `LiquidityService` | 写链上 | 添加/移除流动性、收取手续费、销毁空仓位 |
| `transfer` | `TransferService` | 写链上 | 发送 BNB / ATX / USDT / 任意 ERC20 |

### 钱包管理 (WalletManager)

使用 keystore V3 格式存储私钥，加密参数：

- KDF: scrypt (N=8192, r=8, p=1)
- Cipher: aes-128-ctr
- MAC: sha256

每个钱包以 `{address}.json` 存储在 `keystorePath` 目录。`load()` 返回 `UnlockedWallet` 对象，包含 `walletClient` 和 `account`，可直接传给其他模块的写方法。

### 安全密码存储 (SecretStore)

SDK 内置跨平台安全密码存储层，支持**创建钱包时输入一次密码，后续自动解锁**。

#### 平台策略

| 平台 | 存储后端 | 实现 |
|---|---|---|
| macOS 桌面 | Keychain | `security` CLI |
| Linux 桌面 | Secret Service / GNOME Keyring | `secret-tool` CLI |
| 其他环境（含服务器） | master key file | `aes-256-gcm` 加密的本地文件 |

#### 默认路径

| 文件 | 默认路径 |
|---|---|
| `master.key` | `~/.config/atx-agent/master.key` |
| `secrets.json` | `~/.config/atx-agent/secrets.json` |

这些默认值是固定的，不支持通过环境变量覆盖。

#### 行为

- `create()` / `importPrivateKey()` 成功后默认自动保存密码（可通过 `options.savePassword = false` 关闭）
- `load(address)` 不传密码时自动从 SecretStore 读取
- `load(address, password)` 传了密码时使用该密码并同步保存
- `exportPrivateKey(address)` 同样支持自动取密

#### 新增方法

| 方法 | 说明 |
|---|---|
| `savePassword(address, password)` | 手动保存密码到安全存储 |
| `forgetPassword(address)` | 从安全存储中删除密码 |
| `hasSavedPassword(address)` | 检查是否已保存密码 |
| `loadAuto(address)` | `load(address)` 的别名，纯自动解锁 |

#### File Store 存储格式

对于 master key file 后端：

- `master.key`：首次使用时自动生成 32 字节随机密钥，权限 `600`
- `secrets.json`：按地址索引的加密密码，使用 `aes-256-gcm` 加密
- `master.key` 只用于加密"keystore 密码"，不替代 keystore 本身

### 交换流程 (SwapService)

`buy()` / `sell()` 内部流程：

1. 调用 Quoter 获取预期输出量
2. 根据滑点计算 `amountOutMinimum`
3. 检查 allowance，不足则 approve `maxUint256`
4. 调用 SwapRouter `exactInputSingle`
5. 等待交易确认，revert 则抛出异常

### 流动性管理 (LiquidityService)

- `addLiquidity()` — 默认全范围（tick -887200 ~ 887200），也支持自定义 tick 区间
- `removeLiquidity()` — 按百分比移除，100% 时自动附加 `burn` 调用
- `collectFees()` — 收取累积手续费
- `burnPosition()` — 销毁已清空的 LP NFT

`removeLiquidity` 使用 NPM 的 `multicall` 将 decreaseLiquidity + collect（+ burn）打包为单笔交易。

## 核心类型

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

## 默认常量

| 常量 | 值 | 说明 |
|---|---|---|
| `DEFAULT_RPC_URL` | `https://bsc-rpc.publicnode.com` | 公共 BSC RPC |
| `DEFAULT_POOL_FEE` | `2500` | 0.25% 手续费档位 |
| `DEFAULT_SLIPPAGE_BPS` | `300` | 3% 默认滑点 |
| `DEADLINE_SECONDS` | `1200` | 交易 deadline 20 分钟 |
| `MAX_UINT128` | `2^128 - 1` | collect 时用于取回全部手续费 |

## 使用示例

### 查询价格和余额

```typescript
import { AtxClient } from "atx-agent-sdk";

const client = new AtxClient();

const price = await client.query.getPrice();
console.log(`1 ATX = ${price.usdtPerAtx} USDT`);

const bal = await client.query.getBalance("0x...");
console.log(`BNB: ${bal.bnb}, ATX: ${bal.atx}, USDT: ${bal.usdt}`);
```

### 创建钱包并交换

```typescript
import { AtxClient, parseUnits } from "atx-agent-sdk";

const client = await new AtxClient().ready();

// 创建钱包（密码自动保存到安全存储）
const { address } = await client.wallet.create("my-password", "trading-wallet");

// 后续加载无需密码
const wallet = await client.wallet.load(address);

// 用 10 USDT 买入 ATX（滑点 1%）
const result = await client.swap.buy(wallet, parseUnits("10", 18), 100);
console.log(`TX: ${result.txHash}`);
```

### 添加流动性

```typescript
import { AtxClient, parseEther, parseUnits } from "atx-agent-sdk";

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

### 转账

```typescript
import { AtxClient, parseEther } from "atx-agent-sdk";

const client = await new AtxClient().ready();
const wallet = await client.wallet.load("0x...");

// 发送 BNB
await client.transfer.sendBnb(wallet, "0xRecipient", parseEther("0.1"));

// 发送 ATX
await client.transfer.sendAtx(wallet, "0xRecipient", parseEther("100"));
```

## 导出清单

SDK 通过 `index.ts` 统一导出：

- **类**：`AtxClient`, `WalletManager`, `QueryService`, `SwapService`, `LiquidityService`, `TransferService`
- **类型**：`ContractAddresses`, `AtxClientConfig`, `SecretStore`, `WalletCreateOptions`, `UnlockedWallet`, `KeystoreInfo`, `PriceResult`, `BalanceResult`, `QuoteResult`, `PositionData`, `TokenInfo`, `SwapResult`, `LiquidityAddOptions`, `TxResult`
- **常量**：`BSC_CHAIN_ID`, `DEFAULT_RPC_URL`, `DEFAULT_CONTRACTS`, `DEFAULT_POOL_FEE`, `DEFAULT_SLIPPAGE_BPS`, `MAX_UINT128`, `DEADLINE_SECONDS`
- **ABI**：`erc20Abi`, `swapRouterAbi`, `quoterAbi`, `poolAbi`, `npmAbi`
- **viem 工具**（re-export）：`parseEther`, `parseUnits`, `formatEther`, `formatUnits`

## 开发指南

### 添加新模块

1. 在 `src/` 下创建新的 service 文件（如 `src/staking.ts`）
2. 构造函数接收 `PublicClient` + `ContractAddresses`，保持与现有模块一致
3. 在 `client.ts` 的 `AtxClient` 中添加实例属性并在构造函数中初始化
4. 在 `index.ts` 中导出新类
5. 如需新的 ABI，在 `src/abi/` 下添加并在 `src/abi/index.ts` 中导出
6. 如需新的类型，在 `types.ts` 中定义

### 添加新的合约交互

1. 在对应的 ABI 文件中添加所需函数签名
2. 在对应 service 中实现方法
3. 写交易的方法需接收 `UnlockedWallet` 参数
4. 写交易后必须调用 `waitForTransactionReceipt` 并检查 `receipt.status`
5. 如需 ERC20 approve，参考 `SwapService.ensureApproval()` 的实现

### 注意事项

- 金额均使用 `bigint`（18 位精度），用 viem 的 `parseEther` / `parseUnits` 转换
- 写交易方法统一返回 `TxResult` 或 `SwapResult`，包含 `txHash`
- 交易 revert 时抛出 `Error`，调用方需 try/catch 处理
- ABI 只包含实际使用的函数片段，不是完整 ABI

## License

MIT
