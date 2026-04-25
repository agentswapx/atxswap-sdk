# Changelog

## 0.0.9

- README / README.zh: link to the ATXSwap documentation [team introduction](https://docs.atxswap.com/guide/team) pages; keep SDK docs focused on the API.

## 0.0.8

- Maintenance release; version bump for npm publish.

## 0.0.7

- Fixed MetaMask / Web3 Secret Storage V3 compatibility for generated
  keystores. New keystores now compute `crypto.mac` with Ethereum-compatible
  `keccak256(derivedKey[16:32] + ciphertext)` instead of `sha256`.
- Kept SDK read compatibility for legacy `sha256`-MAC keystores created by
  earlier SDK versions.
- Added `WalletManager.exportMetaMaskKeystore(address, password?)`, which
  decrypts an existing SDK keystore locally and re-encrypts it as a
  MetaMask-compatible encrypted keystore JSON without exposing the raw private
  key. It uses the saved SecretStore password when available, otherwise the
  caller must provide a password.

## 0.0.6

- **Fix (headless / cron)**: `detectStoreType()` no longer locks into the
  `secret-service` backend just because the `secret-tool` binary is on
  `PATH`. On Linux the SDK now also requires `DBUS_SESSION_BUS_ADDRESS` to
  be set; otherwise it falls back to the encrypted file store. This stops
  `secret-tool store` from blowing up under cron, sandboxed CI and SSH
  sessions without a forwarded D-Bus.
- Added `ATXSWAP_SECRET_STORE` environment variable to force a backend
  (`keychain` | `secret-service` | `file` | `none`). The new `none` backend
  is a no-op store for callers that always pass `--password` explicitly and
  do not want any password persistence.
- `WalletManager.create()` now treats password persistence as best-effort:
  if the secret backend rejects the write, the keystore is still written to
  disk and the call returns `{ passwordSaved: false, passwordSaveError }`
  instead of throwing. `WalletManager.load(address, password)` likewise
  swallows save errors because the wallet is already unlocked.
- Re-exported `NoopSecretStore` and `FileSecretStore` from the package
  entry for advanced consumers that want to construct a backend explicitly.

## 0.0.5

- Updated `DEFAULT_CONTRACTS` to point at the production ATX token and ATX/USDT
  pool addresses on BSC mainnet:
  - `atx`: `0x31bD373bDde9e65Ff681d2970b4b01B8b2C750e0`
  - `pool`: `0xC3Bd1991332308da3c3571c334941f3398FD91B6`
  Consumers that relied on the old defaults should override them via
  `AtxClient` config or upgrade to pick up the new defaults.
- Version `0.0.4` was intentionally skipped to keep parity with the
  `atxswap` skill release line.

## 0.0.3

- **Breaking**: removed `WalletManager.importPrivateKey()`. The SDK no longer
  exposes a path for importing an existing private key; the only supported way
  to provision a wallet is `WalletManager.create()`, which now generates a fresh
  private key and writes the encrypted keystore in a single step.
- **Breaking**: removed `WalletManager.exportPrivateKey()`. Replaced by
  `WalletManager.exportKeystore(address)`, which returns the on-disk encrypted
  Keystore V3 JSON together with its absolute file path. The SDK no longer has
  any API that returns the unencrypted private key.
- Added `KeystoreFile` to the public type exports for consumers that need to
  type the keystore JSON returned by `exportKeystore()`.

## 0.0.2

- Added 8-endpoint BSC RPC fallback list using viem's `fallback` transport.
  `BSC_RPC_URL` accepts a single URL or a comma-separated list.

## 0.0.1

- Initial public release of the ATX TypeScript SDK for BSC and PancakeSwap V3
  (wallet management, price/balance queries, swap, liquidity, and transfer
  modules).
