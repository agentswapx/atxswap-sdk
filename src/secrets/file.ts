import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import type { SecretStore } from "./types.js";
import {
  getDefaultMasterKeyPath,
  getDefaultSecretStorePath,
  normalizeAddress,
} from "./utils.js";

interface SecretsData {
  [address: string]: {
    iv: string;
    tag: string;
    ciphertext: string;
  };
}

export class FileSecretStore implements SecretStore {
  private readonly masterKeyPath: string;
  private readonly secretStorePath: string;

  constructor() {
    this.masterKeyPath = getDefaultMasterKeyPath();
    this.secretStorePath = getDefaultSecretStorePath();
  }

  async get(address: string): Promise<string | null> {
    const addr = normalizeAddress(address);
    const data = this.readSecrets();
    const entry = data[addr];
    if (!entry) return null;

    const key = this.loadOrCreateMasterKey();
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(entry.iv, "hex"),
      );
      decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, "hex")),
        decipher.final(),
      ]);
      return decrypted.toString("utf-8");
    } catch {
      return null;
    }
  }

  async set(address: string, secret: string): Promise<void> {
    const addr = normalizeAddress(address);
    const key = this.loadOrCreateMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(secret, "utf-8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const data = this.readSecrets();
    data[addr] = {
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    };
    this.writeSecrets(data);
  }

  async delete(address: string): Promise<void> {
    const addr = normalizeAddress(address);
    const data = this.readSecrets();
    if (!(addr in data)) return;
    delete data[addr];
    this.writeSecrets(data);
  }

  async has(address: string): Promise<boolean> {
    const addr = normalizeAddress(address);
    const data = this.readSecrets();
    return addr in data;
  }

  private loadOrCreateMasterKey(): Buffer {
    if (existsSync(this.masterKeyPath)) {
      return readFileSync(this.masterKeyPath);
    }
    this.ensureDir(this.masterKeyPath);
    const key = randomBytes(32);
    writeFileSync(this.masterKeyPath, key, { mode: 0o600 });
    try {
      chmodSync(this.masterKeyPath, 0o600);
    } catch { /* best-effort on platforms that don't support chmod */ }
    return key;
  }

  private readSecrets(): SecretsData {
    if (!existsSync(this.secretStorePath)) return {};
    try {
      return JSON.parse(readFileSync(this.secretStorePath, "utf-8")) as SecretsData;
    } catch {
      return {};
    }
  }

  private writeSecrets(data: SecretsData): void {
    this.ensureDir(this.secretStorePath);
    writeFileSync(this.secretStorePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.secretStorePath, 0o600);
    } catch { /* best-effort */ }
  }

  private ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
