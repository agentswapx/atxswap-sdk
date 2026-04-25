import { execFileSync } from "node:child_process";
import type { SecretStore } from "./types.js";
import { getServiceName, normalizeAddress } from "./utils.js";

export class SecretServiceStore implements SecretStore {
  private readonly service: string;

  constructor() {
    this.service = getServiceName();
  }

  async get(address: string): Promise<string | null> {
    const account = normalizeAddress(address);
    try {
      const result = execFileSync("secret-tool", [
        "lookup",
        "service", this.service,
        "account", account,
      ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      const trimmed = result.trim();
      return trimmed || null;
    } catch {
      return null;
    }
  }

  async set(address: string, secret: string): Promise<void> {
    const account = normalizeAddress(address);
    try {
      execFileSync("secret-tool", [
        "store",
        "--label", `${this.service}:${account}`,
        "service", this.service,
        "account", account,
      ], { input: secret, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      // In headless environments (cron, sandboxed CI, SSH without DBUS) the
      // `secret-tool` binary may exist but the libsecret daemon is not
      // reachable. Surface a typed error so callers can choose to ignore
      // failed memorization without dropping the primary operation.
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `secret-service unavailable (set): ${cause}. ` +
          "Set ATXSWAP_SECRET_STORE=file to use the file backend, or " +
          "ATXSWAP_SECRET_STORE=none to disable password persistence.",
      );
    }
  }

  async delete(address: string): Promise<void> {
    const account = normalizeAddress(address);
    try {
      execFileSync("secret-tool", [
        "clear",
        "service", this.service,
        "account", account,
      ], { stdio: "pipe" });
    } catch { /* ignore if not exists or backend unavailable */ }
  }

  async has(address: string): Promise<boolean> {
    return (await this.get(address)) !== null;
  }
}
