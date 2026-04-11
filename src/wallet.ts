import {
  createWalletClient,
  http,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import type { UnlockedWallet, KeystoreInfo, WalletCreateOptions } from "./types.js";
import type { SecretStore } from "./secrets/types.js";

interface KeystoreV3 {
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

export class WalletManager {
  private readonly keystorePath: string;
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private secretStore: SecretStore | null;

  constructor(keystorePath: string, chain: Chain, rpcUrl: string, secretStore?: SecretStore) {
    this.keystorePath = keystorePath;
    this.chain = chain;
    this.rpcUrl = rpcUrl;
    this.secretStore = secretStore ?? null;
  }

  setSecretStore(store: SecretStore): void {
    this.secretStore = store;
  }

  private ensureDir(): void {
    if (!existsSync(this.keystorePath)) {
      mkdirSync(this.keystorePath, { recursive: true });
    }
  }

  async create(
    password: string,
    name?: string,
    options?: WalletCreateOptions,
  ): Promise<{ address: Address; keystoreFile: string }> {
    const privateKey = generatePrivateKey();
    return this.importPrivateKey(privateKey, password, name, options);
  }

  async importPrivateKey(
    privateKey: `0x${string}`,
    password: string,
    name?: string,
    options?: WalletCreateOptions,
  ): Promise<{ address: Address; keystoreFile: string }> {
    this.ensureDir();
    const account = privateKeyToAccount(privateKey);
    const keystore = encryptKeystore(privateKey, password, name);
    const filename = `${account.address.toLowerCase()}.json`;
    const filepath = join(this.keystorePath, filename);
    writeFileSync(filepath, JSON.stringify(keystore, null, 2));

    const shouldSave = options?.savePassword ?? true;
    if (shouldSave && this.secretStore) {
      await this.secretStore.set(account.address, password);
    }

    return { address: account.address, keystoreFile: filepath };
  }

  list(): KeystoreInfo[] {
    this.ensureDir();
    const files = readdirSync(this.keystorePath).filter((f) => f.endsWith(".json"));
    return files.map((filename) => {
      const raw = JSON.parse(readFileSync(join(this.keystorePath, filename), "utf-8")) as KeystoreV3;
      return {
        address: `0x${raw.address}` as Address,
        name: raw.name,
        filename,
      };
    });
  }

  async load(address: Address, password?: string): Promise<UnlockedWallet> {
    const filename = `${address.toLowerCase()}.json`;
    const filepath = join(this.keystorePath, filename);
    if (!existsSync(filepath)) {
      throw new Error(`Keystore file not found for address ${address}`);
    }

    let pwd = password;
    if (!pwd && this.secretStore) {
      pwd = (await this.secretStore.get(address)) ?? undefined;
    }
    if (!pwd) {
      throw new Error(
        "Password required: provide a password or save one first via savePassword()",
      );
    }

    const raw = JSON.parse(readFileSync(filepath, "utf-8")) as KeystoreV3;
    const privateKey = decryptKeystore(raw, pwd);
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(this.rpcUrl),
    });

    if (password && this.secretStore) {
      await this.secretStore.set(address, password);
    }

    return { address: account.address, walletClient, account, chain: this.chain };
  }

  async loadAuto(address: Address): Promise<UnlockedWallet> {
    return this.load(address);
  }

  async exportPrivateKey(address: Address, password?: string): Promise<`0x${string}`> {
    const filename = `${address.toLowerCase()}.json`;
    const filepath = join(this.keystorePath, filename);
    if (!existsSync(filepath)) {
      throw new Error(`Keystore file not found for address ${address}`);
    }

    let pwd = password;
    if (!pwd && this.secretStore) {
      pwd = (await this.secretStore.get(address)) ?? undefined;
    }
    if (!pwd) {
      throw new Error(
        "Password required: provide a password or save one first via savePassword()",
      );
    }

    const raw = JSON.parse(readFileSync(filepath, "utf-8")) as KeystoreV3;
    return decryptKeystore(raw, pwd);
  }

  async savePassword(address: Address, password: string): Promise<void> {
    if (!this.secretStore) {
      throw new Error("No SecretStore configured");
    }
    await this.secretStore.set(address, password);
  }

  async forgetPassword(address: Address): Promise<void> {
    if (!this.secretStore) return;
    await this.secretStore.delete(address);
  }

  async hasSavedPassword(address: Address): Promise<boolean> {
    if (!this.secretStore) return false;
    return this.secretStore.has(address);
  }
}

function encryptKeystore(privateKey: `0x${string}`, password: string, name?: string): KeystoreV3 {
  const keyBytes = Buffer.from(privateKey.slice(2), "hex");
  const salt = randomBytes(32);
  const iv = randomBytes(16);

  const kdfparams = { dklen: 32, n: 8192, r: 8, p: 1, salt: salt.toString("hex") };
  const derivedKey = scryptSync(Buffer.from(password), salt, kdfparams.dklen, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
  });

  const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(keyBytes), cipher.final()]);

  const mac = createHash("sha256")
    .update(Buffer.concat([derivedKey.subarray(16, 32), ciphertext]))
    .digest("hex");

  const account = privateKeyToAccount(privateKey);

  return {
    version: 3,
    address: account.address.toLowerCase().slice(2),
    ...(name ? { name } : {}),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams,
      mac,
    },
  };
}

function decryptKeystore(keystore: KeystoreV3, password: string): `0x${string}` {
  const { crypto: c } = keystore;
  const salt = Buffer.from(c.kdfparams.salt, "hex");
  const derivedKey = scryptSync(Buffer.from(password), salt, c.kdfparams.dklen, {
    N: c.kdfparams.n,
    r: c.kdfparams.r,
    p: c.kdfparams.p,
  });

  const ciphertext = Buffer.from(c.ciphertext, "hex");

  const mac = createHash("sha256")
    .update(Buffer.concat([derivedKey.subarray(16, 32), ciphertext]))
    .digest("hex");

  if (mac !== c.mac) {
    throw new Error("Invalid password: MAC mismatch");
  }

  const iv = Buffer.from(c.cipherparams.iv, "hex");
  const decipher = createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return `0x${privateKey.toString("hex")}`;
}
