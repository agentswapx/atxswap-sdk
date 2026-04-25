export type SecretStoreType = "keychain" | "secret-service" | "file" | "none";

export interface SecretStore {
  get(address: string): Promise<string | null>;
  set(address: string, secret: string): Promise<void>;
  delete(address: string): Promise<void>;
  has(address: string): Promise<boolean>;
}
