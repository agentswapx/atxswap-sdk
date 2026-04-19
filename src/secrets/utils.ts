import { homedir, platform } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SecretStoreType } from "./types.js";

const SERVICE_NAME = "atxswap-sdk";

export function getServiceName(): string {
  return SERVICE_NAME;
}

export function getDefaultConfigDir(): string {
  return join(homedir(), ".config", "atxswap");
}

export function getDefaultMasterKeyPath(): string {
  return join(getDefaultConfigDir(), "master.key");
}

export function getDefaultSecretStorePath(): string {
  return join(getDefaultConfigDir(), "secrets.json");
}

function isCommandAvailable(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function detectStoreType(): SecretStoreType {
  if (platform() === "darwin" && isCommandAvailable("security")) return "keychain";
  if (platform() === "linux" && isCommandAvailable("secret-tool")) return "secret-service";
  return "file";
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
