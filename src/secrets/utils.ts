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

const VALID_OVERRIDES: ReadonlySet<SecretStoreType> = new Set([
  "keychain",
  "secret-service",
  "file",
  "none",
]);

function readOverride(): SecretStoreType | null {
  const raw = process.env.ATXSWAP_SECRET_STORE?.trim().toLowerCase();
  if (!raw) return null;
  return VALID_OVERRIDES.has(raw as SecretStoreType)
    ? (raw as SecretStoreType)
    : null;
}

function hasUsableSecretService(): boolean {
  if (!isCommandAvailable("secret-tool")) return false;
  // `secret-tool` will hang or error in headless environments (cron, SSH
  // without forwarded D-Bus, sandboxed CI) because there is no session bus
  // and no keyring daemon. Require an explicit DBUS session before claiming
  // the backend is usable.
  return Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
}

export function detectStoreType(): SecretStoreType {
  const override = readOverride();
  if (override) return override;
  if (platform() === "darwin" && isCommandAvailable("security")) return "keychain";
  if (platform() === "linux" && hasUsableSecretService()) return "secret-service";
  return "file";
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
