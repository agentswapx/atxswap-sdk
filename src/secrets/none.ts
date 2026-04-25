import type { SecretStore } from "./types.js";

/**
 * No-op secret store. Used when the user opts out of password persistence via
 * `ATXSWAP_SECRET_STORE=none`. Every `get`/`has` returns "not found"; `set`
 * and `delete` are silent no-ops. The wallet still works as long as the
 * caller passes `--password` (or `password` argument) on every load.
 */
export class NoopSecretStore implements SecretStore {
  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {
    /* intentional no-op */
  }

  async delete(): Promise<void> {
    /* intentional no-op */
  }

  async has(): Promise<boolean> {
    return false;
  }
}
