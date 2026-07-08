# Testing XORR

This is the full, reproducible test matrix for the two packages in this
monorepo. Every command and count below was run against `main` (commit
`1f03f60`) right before writing this file.

- `contracts/EncryptedERC` (Hardhat): **144/144 passing**
- `web` (Node's built-in test runner via `tsx`): **51/51 passing**

Nothing in `npm test` / `npx hardhat test` touches a live network. Fuji and
Sepolia are only touched by the scripts under `contracts/EncryptedERC/scripts/`,
which are run explicitly and separately (see [Live network scripts](#live-network-scripts)).

---

## 1. `contracts/EncryptedERC` — Hardhat, real ZK proofs

### Requirements

- **Node 22.** Hardhat + `hardhat-zkit`'s circom toolchain break on Node 25
  (this repo's default `node` on some machines). Switch first:

  ```bash
  nvm use 22
  ```

- First install compiles the Solidity contracts and builds the 5 eERC circuits
  (`registration`, `mint`, `transfer`, `withdraw`, `burn`) via `hardhat-zkit`,
  downloading `circom` and a Powers-of-Tau file:

  ```bash
  cd contracts/EncryptedERC
  npm install   # runs the postinstall: hardhat compile + zkit make + zkit verifiers
  ```

### Run the suite

```bash
cd contracts/EncryptedERC
npx hardhat test
```

- **144 passing**, ~44–46s on a local in-memory Hardhat network.
- Circuits are only rebuilt once (on install, or if `zkit/artifacts` is
  missing/stale) — after that, `npx hardhat test` reuses the compiled
  circuits and just runs (proof generation still happens per-test, which is
  most of the ~45s).
- This is **not mocked**: every proof (registration, mint, transfer, withdraw,
  burn, and the AMM/bridge flows) is a real Groth16 proof generated and
  verified on-chain against the compiled circuits, on Hardhat's local network.

### What's covered

The suite is the upstream `ava-labs/EncryptedERC` converter/standalone/registrar
tests, plus XORR's own integration and unit suites, all in
`contracts/EncryptedERC/test/`:

| File | What it proves |
|---|---|
| `EncryptedERC-Standalone.ts` | Upstream standalone-mode eERC: registration, mint, transfer, burn, auditor decrypt |
| `EncryptedERC-Converter.ts` | Upstream converter-mode eERC: wrapping an existing ERC-20 into encrypted balances |
| `EncryptedMetadata.ts` | Encrypted metadata helper coverage |
| `xorr-flow.ts` | End-to-end: mint 100 xUSD → Alice, Alice privately pays Bob 30, Bob withdraws (burns) 10 — balances decrypt correctly at each step, plus an `auditorDecrypt` check |
| `xorr-bridge.ts` | Integration: lock 50 USDC → relayer `privateMint`s 50 xUSD; burn 20 xUSD → relayer releases 20 USDC; a replayed release is rejected (nullifier-guarded) |
| `xorr-swap.ts` | Integration: public AMM swap (50 USDC → XAV) **and** a confidential swap (burn xUSD → relayer swaps on the AMM → output routed to a fresh, unlinked address) |
| `xorr-bridge-unit.ts` | 13 unit tests on `XorrBridge.sol`: access control (`NotRelayer`), zero-amount reverts, `lock`/`release` accounting, `Locked`/`Released`/`RelayerChanged` events, relayer rotation, nullifier replay protection |
| `xorr-amm-unit.ts` | 18 unit tests on `XorrAMM.sol`: constant-product (`x·y=k`) math, `addLiquidity`, `quote()` in both directions, slippage (`Slippage` revert), reserve accounting across multiple swaps, routing output to a different address |
| `helpers.ts`, `user.ts` | Shared test fixtures (not test suites themselves — proof-generation and `User` key-derivation helpers used by the above) |

`test/xorr-*.ts` alone (flow / bridge / swap / bridge-unit / amm-unit) is the
XORR-specific layer on top of the upstream eERC suite; run just those with:

```bash
npx hardhat test test/xorr-*.ts
```

### Forking is opt-in, never on by default

`hardhat.config.ts` defines a `hardhat` network with
`forking.enabled: !!process.env.FORKING` — forking (and any real RPC call) is
gated behind the `FORKING` env var, which is unset in the default test run.
`npx hardhat test` never talks to Avalanche mainnet, Fuji, or Sepolia.

---

## 2. `web` — Node test runner via `tsx`

```bash
cd web
npm install --legacy-peer-deps   # the eERC SDK declares a stale wagmi-v1 peer range
npm test
```

`test` runs `node --import tsx --test test/*.test.ts` — **51 tests, 0 failures**,
in under 2 seconds, no network or browser required. Files:

- `format.test.ts`
- `identity.test.ts`
- `poseidon.test.ts`
- `disclosure-receipt.test.ts`
- `delivery.test.ts`
- `notes.test.ts`
- `notes-extra.test.ts`
- `compliance.test.ts`

These exercise pure crypto/formatting/identity-derivation logic (BabyJubJub /
Poseidon helpers, note commitments/nullifiers, shielded-tree membership,
disclosure receipts, wallet key derivation) independent of any deployed
contract — no Fuji RPC calls happen here either.

This package needs **no particular Node version** for its own test run (it
was verified passing on both Node 22 and the newer Node installed by
default); Node 22 is only a hard requirement for the Hardhat/circom side in
`contracts/EncryptedERC`.

### A build detail worth knowing: the eERC SDK / wagmi v1 shim

`web/` is a Next.js 15 app (not a bundler-less setup) that consumes
`@avalabs/ac-eerc-sdk`, which imports `erc20ABI` from **wagmi v1** even though
this app runs **wagmi v2**. `web/next.config.mjs` works around this with a
webpack alias:

```js
wagmi$: path.resolve(__dirname, 'lib/wagmi-compat.ts'),
'wagmi-real$': require.resolve('wagmi'),
```

The exact `"wagmi"` import specifier resolves to `lib/wagmi-compat.ts`, which
re-exports wagmi v2 plus a shimmed `erc20ABI`; `wagmi/chains`, `wagmi/connectors`,
etc. are untouched (the `$` means exact-match only). The same config also adds
Node-builtin polyfills (`buffer`, `crypto-browserify`, `stream-browserify`,
etc.) because `snarkjs` / `circomlibjs` expect Node globals in the browser —
a leftover comment in the config notes this used to be handled by
`vite-plugin-node-polyfills` before the app moved to Next.js/webpack.

---

## 3. Live network scripts (not part of `npm test` / `hardhat test`)

These require a **funded Fuji** (and, for the cross-chain demo, Sepolia)
private key and read the deployed addresses from
`contracts/EncryptedERC/deployments/fuji.json`. Run from
`contracts/EncryptedERC/`:

```bash
PRIVATE_KEY=0x<funded key> npx hardhat run scripts/live-mint-pay.ts --network fuji
```

- **`scripts/live-mint-pay.ts`** — registers two fresh wallets (Alice, Bob)
  against the deployed `Registrar`, mints 100 xUSD to Alice, has Alice
  confidentially transfer 30 to Bob, and prints Snowtrace links plus each
  wallet's locally-decrypted balance. Last verified run: Alice 70.00 xUSD /
  Bob 30.00 xUSD.
- **`scripts/live-bridge.ts`** — same-chain lock-and-mint / burn-and-release
  cycle against the deployed `XorrBridge`, run with `--network fuji`.
- **`scripts/live-xchain-bridge.ts`** — genuine cross-chain demo: lock USDC on
  **Sepolia**, watched by **`scripts/relayer-xchain.ts`** (run separately,
  `--network fuji`), which mints private xUSD on **Fuji**.
- **`scripts/relayer.ts`** — watches `Locked` events on the Fuji-side
  `XorrBridge` and calls `privateMint` for the same-chain bridge demo.
- **`scripts/deploy-xorr.ts`** / **`deploy-xorr-defi.ts`** /
  **`deploy-sepolia-bridge.ts`** — deployment scripts for the standalone eERC
  token, the `XorrBridge`/`XorrAMM` DeFi contracts, and the Sepolia-side
  escrow, respectively. `deploy-xorr.ts` is what produced
  `contracts/EncryptedERC/deployments/fuji.json`.

None of these run as part of `npm test` in either package, and none run in
CI-equivalent local test commands — they require a funded key and are meant
to be triggered by hand against Fuji/Sepolia testnets.

---

## Summary

| Package | Command | Result | Network touched |
|---|---|---|---|
| `contracts/EncryptedERC` | `npx hardhat test` (Node 22) | 144/144 passing, ~44–46s | none (local Hardhat net, real proofs) |
| `web` | `npm test` | 51/51 passing, <2s | none |
| `contracts/EncryptedERC/scripts/live-*.ts` | `npx hardhat run scripts/<name>.ts --network fuji\|sepolia` | manual, requires funded `PRIVATE_KEY` | Fuji and/or Sepolia testnets |
