# Changelog

## 0.0.5

- Updated `DEFAULT_CONTRACTS` to point at the production ATX token and ATX/USDT
  pool addresses on BSC mainnet:
  - `atx`: `0x82dbfD98AE6741C8506640CE235c6d95570EA638`
  - `pool`: `0x157003c4a71697a79f300419eaee271a5f21acaa`
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
