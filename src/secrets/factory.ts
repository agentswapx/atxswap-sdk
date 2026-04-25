import type { SecretStore } from "./types.js";
import { detectStoreType } from "./utils.js";

export async function createSecretStore(): Promise<SecretStore> {
  const type = detectStoreType();

  switch (type) {
    case "keychain": {
      const { KeychainStore } = await import("./keychain.js");
      return new KeychainStore();
    }
    case "secret-service": {
      const { SecretServiceStore } = await import("./secretService.js");
      return new SecretServiceStore();
    }
    case "none": {
      const { NoopSecretStore } = await import("./none.js");
      return new NoopSecretStore();
    }
    case "file":
    default: {
      const { FileSecretStore } = await import("./file.js");
      return new FileSecretStore();
    }
  }
}
