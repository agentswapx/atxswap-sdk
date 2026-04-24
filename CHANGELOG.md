# Changelog

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
