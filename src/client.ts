import { createPublicClient, http, type PublicClient, type Chain } from "viem";
import { bsc } from "viem/chains";
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACTS,
  DEFAULT_POOL_FEE,
} from "./constants.js";
import type { AtxClientConfig, ContractAddresses } from "./types.js";
import { WalletManager } from "./wallet.js";
import { QueryService } from "./query.js";
import { SwapService } from "./swap.js";
import { LiquidityService } from "./liquidity.js";
import { TransferService } from "./transfer.js";
import { createSecretStore } from "./secrets/factory.js";

export class AtxClient {
  readonly publicClient: PublicClient;
  readonly contracts: ContractAddresses;
  readonly poolFee: number;
  readonly chain: Chain;

  readonly wallet: WalletManager;
  readonly query: QueryService;
  readonly swap: SwapService;
  readonly liquidity: LiquidityService;
  readonly transfer: TransferService;

  private _secretStoreReady: Promise<void>;

  constructor(config: AtxClientConfig = {}) {
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL;
    this.chain = bsc;
    this.poolFee = config.poolFee ?? DEFAULT_POOL_FEE;
    this.contracts = { ...DEFAULT_CONTRACTS, ...config.contracts };

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    });

    this.wallet = new WalletManager(config.keystorePath ?? "./keystore", this.chain, rpcUrl);
    this.query = new QueryService(this.publicClient, this.contracts, this.poolFee);
    this.swap = new SwapService(this.publicClient, this.contracts, this.poolFee);
    this.liquidity = new LiquidityService(this.publicClient, this.contracts, this.poolFee);
    this.transfer = new TransferService(this.publicClient, this.contracts);

    this._secretStoreReady = createSecretStore().then((store) => {
      this.wallet.setSecretStore(store);
    });
  }

  async ready(): Promise<this> {
    await this._secretStoreReady;
    return this;
  }
}
