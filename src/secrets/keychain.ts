import { execFileSync } from "node:child_process";
import type { SecretStore } from "./types.js";
import { getServiceName, normalizeAddress } from "./utils.js";

export class KeychainStore implements SecretStore {
  private readonly service: string;

  constructor() {
    this.service = getServiceName();
  }

  async get(address: string): Promise<string | null> {
    const account = normalizeAddress(address);
    try {
      const result = execFileSync("security", [
        "find-generic-password",
        "-s", this.service,
        "-a", account,
        "-w",
      ], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return result.trim();
    } catch {
      return null;
    }
  }

  async set(address: string, secret: string): Promise<void> {
    const account = normalizeAddress(address);
    try {
      await this.delete(address);
    } catch { /* ignore if not exists */ }

    execFileSync("security", [
      "add-generic-password",
      "-s", this.service,
      "-a", account,
      "-w", secret,
      "-U",
    ], { stdio: "pipe" });
  }

  async delete(address: string): Promise<void> {
    const account = normalizeAddress(address);
    try {
      execFileSync("security", [
        "delete-generic-password",
        "-s", this.service,
        "-a", account,
      ], { stdio: "pipe" });
    } catch { /* ignore if not exists */ }
  }

  async has(address: string): Promise<boolean> {
    return (await this.get(address)) !== null;
  }
}
