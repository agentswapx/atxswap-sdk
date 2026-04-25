import {
  createWalletClient,
  fallback,
  http,
  type Address,
  type Chain,
  keccak256,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import type {
  UnlockedWallet,
  KeystoreInfo,
  WalletCreateOptions,
  KeystoreFile,
} from "./types.js";
import type { SecretStore } from "./secrets/types.js";

type KeystoreV3 = KeystoreFile;

export class WalletManager {
  private readonly keystorePath: string;
  private readonly chain: Chain;
  private readonly rpcUrls: string[];
  private secretStore: SecretStore | null;

  constructor(keystorePath: string, chain: Chain, rpcUrls: string[], secretStore?: SecretStore) {
    this.keystorePath = keystorePath;
    this.chain = chain;
    this.rpcUrls = rpcUrls;
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
  ): Promise<{
    address: Address;
    keystoreFile: string;
    passwordSaved: boolean;
    passwordSaveError?: string;
  }> {
    this.ensureDir();
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const keystore = encryptKeystore(privateKey, password, name);
    const filename = `${account.address.toLowerCase()}.json`;
    const filepath = join(this.keystorePath, filename);
    writeFileSync(filepath, JSON.stringify(keystore, null, 2));

    const shouldSave = options?.savePassword ?? true;
    let passwordSaved = false;
    let passwordSaveError: string | undefined;
    if (shouldSave && this.secretStore) {
      try {
        await this.secretStore.set(account.address, password);
        passwordSaved = true;
      } catch (err) {
        // Best-effort: the keystore is already written, so do not abort
        // wallet creation just because the secret backend is unavailable.
        passwordSaveError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      address: account.address,
      keystoreFile: filepath,
      passwordSaved,
      ...(passwordSaveError ? { passwordSaveError } : {}),
    };
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
      transport: fallback(this.rpcUrls.map((url) => http(url))),
    });

    if (password && this.secretStore) {
      // Best-effort: caller already proved they hold the password, so a
      // failed memorization should not abort the load.
      try {
        await this.secretStore.set(address, password);
      } catch { /* ignore — wallet is already unlocked */ }
    }

    return { address: account.address, walletClient, account, chain: this.chain };
  }

  async loadAuto(address: Address): Promise<UnlockedWallet> {
    return this.load(address);
  }

  exportKeystore(address: Address): { keystore: KeystoreFile; keystoreFile: string } {
    const filename = `${address.toLowerCase()}.json`;
    const filepath = join(this.keystorePath, filename);
    if (!existsSync(filepath)) {
      throw new Error(`Keystore file not found for address ${address}`);
    }
    const keystore = JSON.parse(readFileSync(filepath, "utf-8")) as KeystoreFile;
    return { keystore, keystoreFile: filepath };
  }

  async exportMetaMaskKeystore(
    address: Address,
    password?: string,
  ): Promise<{ keystore: KeystoreFile; keystoreFile: string }> {
    const { keystore: raw, keystoreFile } = this.exportKeystore(address);
    let pwd = password;
    if (!pwd && this.secretStore) {
      pwd = (await this.secretStore.get(address)) ?? undefined;
    }
    if (!pwd) {
      throw new Error(
        "Password required: provide a password or save one first via savePassword()",
      );
    }

    const privateKey = decryptKeystore(raw, pwd);
    return {
      keystore: encryptKeystore(privateKey, pwd, raw.name),
      keystoreFile,
    };
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

  const mac = keystoreMac(derivedKey, ciphertext);

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

  const mac = keystoreMac(derivedKey, ciphertext);
  const legacyMac = legacySha256Mac(derivedKey, ciphertext);

  if (mac !== c.mac && legacyMac !== c.mac) {
    throw new Error("Invalid password: MAC mismatch");
  }

  const iv = Buffer.from(c.cipherparams.iv, "hex");
  const decipher = createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return `0x${privateKey.toString("hex")}`;
}

function keystoreMac(derivedKey: Buffer, ciphertext: Buffer): string {
  return keccak256(Buffer.concat([derivedKey.subarray(16, 32), ciphertext])).slice(2);
}

function legacySha256Mac(derivedKey: Buffer, ciphertext: Buffer): string {
  return createHash("sha256")
    .update(Buffer.concat([derivedKey.subarray(16, 32), ciphertext]))
    .digest("hex");
}
