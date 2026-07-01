<h1 align="center">XORR · eERC on Avalanche</h1>

<p align="center"><b>Private-by-default money on Avalanche.</b></p>

<p align="center">
Hold and transfer <b>xUSD</b> with balances and amounts <b>encrypted on-chain</b> via
<b>eERC (Encrypted ERC)</b> — all cryptography runs client-side, every operation is
verified by a <b>zk-SNARK</b>. Private, <i>not</i> anonymous: a rotatable <b>auditor</b>
keeps it compliance-ready.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Avalanche-Fuji_C--Chain-e84142" alt="Fuji" />
  <img src="https://img.shields.io/badge/eERC-Encrypted_ERC-a855f7" alt="eERC" />
  <img src="https://img.shields.io/badge/ZK-BabyJubJub_·_ElGamal_·_Groth16-67e8f9" alt="ZK" />
</p>

> This is the **Avalanche port of [XORR](https://github.com/nickthelegend/xorr-zk-stellar)**.
> The original shipped confidential money on Stellar/Soroban with a hand-rolled
> BN254 Groth16 shielded-note system. Here the confidential-money layer is
> **Avalanche's eERC** — encrypted balances and transfers are native, so the ZK
> plumbing is provided by the protocol and the SDK. The **premium XORR UI is
> preserved**; only the engine changed.

Built for the **Avalanche "Privacy" Speedrun** (July 2026) — eERC track.

---

## What maps from Stellar → Avalanche

| XORR on Stellar | XORR on Avalanche (eERC) |
|---|---|
| Shield USDC → UTXO note (`deposit`) | **Mint** confidential xUSD (`privateMint`) |
| Private pay (spend notes) | **Private transfer** (`privateTransfer`) |
| Receive (shielded address) | **Receive** to your registered eERC address |
| Withdraw / unshield | **Burn** confidential xUSD (`privateBurn`) |
| Selective disclosure receipt | **Auditor** decrypts history (`auditorDecrypt`) |
| BN254 Groth16 on Soroban | eERC verifiers (BabyJubJub · ElGamal · Poseidon · Groth16) |
| ETH→Stellar bridge | **EVM→Fuji lock-and-mint bridge** — live (Sepolia → Fuji) |
| ZK swaps | **XorrAMM confidential swap** — live (burn xUSD → AMM → fresh addr) |
| SEP-24 off-ramp, money market | Roadmap (premium UI kept) |

**Private, not anonymous.** Every eERC op encodes an *auditor PCT*; the designated
auditor can selectively decrypt the full history for compliance — without
weakening anyone else's privacy, and without a redeploy when the key rotates.

---

## What we built on eERC

eERC (Encrypted ERC, by AvaCloud) is a privacy-preserving, ERC-20-style token
standard: **balances and transfer amounts are encrypted on-chain** (BabyJubJub +
ElGamal + Poseidon, proven with **Groth16 zk-SNARKs**), proofs are generated
**client-side**, everything settles **fully on-chain with no relayers**, and
**rotatable auditor keys** let a regulator decrypt for compliance. It runs
**standalone** (a new private token, optional hidden supply) or **converter**
(wrap an existing ERC-20), ships a **TypeScript SDK**, and runs on C-Chain / Fuji /
custom L1s.

XORR uses eERC **exactly like that** — and adds a product + DeFi layer on top:

- **Standalone eERC token** — `xUSD`, deployed to Fuji via the official
  `ava-labs/EncryptedERC` contracts (verifiers + BabyJubJub + Registrar +
  EncryptedERC). Balances/amounts encrypted on-chain; supply hideable.
- **Client-side, on-chain, no relayers** — the browser (`@avalabs/ac-eerc-sdk`)
  generates every proof; the contract only verifies. Lifecycle:
  `register → generateDecryptionKey → privateMint → privateTransfer → privateBurn`.
- **Rotatable auditor** — the Compliance page sets an auditor
  (`setAuditorPublicKey`) and the auditor decrypts history (`auditorDecrypt`).
- **TypeScript SDK + premium UI** — the original XORR app, re-engined to eERC.

**Beyond the core standard (all tested, live on Fuji):**
- **Bridge** — `XorrBridge.sol`: lock USDC on another EVM chain → a relayer
  `privateMint`s confidential xUSD on Fuji. Proven **Sepolia → Fuji** end-to-end.
- **Confidential swap** — `XorrAMM.sol` (x·y=k): a private swap burns xUSD and
  routes the output to a fresh, unlinked address.
- **Full test suite** — `contracts/EncryptedERC/test/xorr-*.ts` (flow / bridge /
  swap), 4 passing, plus live on-chain runs.

---

## Monorepo layout

```
xorr-eErc-avax/
├─ contracts/EncryptedERC/     # ava-labs/EncryptedERC + XORR deploy script & Fuji config
│  └─ scripts/deploy-xorr.ts   # deploys a STANDALONE eERC (xUSD) to Fuji, writes deployments/fuji.json
└─ web/                        # the XORR premium UI (Next.js 15), engine = @avalabs/ac-eerc-sdk
   ├─ app/                     # home hub (Mint/Pay/Swap/Bridge), withdraw, compliance, faucet, profile, …
   ├─ components/
   │  └─ stellar-wallet-provider.tsx  # the eERC-backed useWallet() context (wagmi + useEERC)
   ├─ lib/config.ts            # Fuji + EERC_ADDRESS + circuit URLs
   └─ public/circuits/         # eERC circuit artifacts (*.wasm / *.zkey) served to the SDK
```

## Tech

- **Contracts** — `ava-labs/EncryptedERC` (Hardhat, circom via `hardhat-zkit`), deployed to **Fuji C-Chain (43113)**.
- **Frontend** — Next.js 15 · Tailwind v4 · Radix/shadcn · framer-motion (the original XORR "ghost/lavender" design), **wagmi v2 + viem** on Fuji, **`@avalabs/ac-eerc-sdk`** for client-side keygen, proofs, encrypt/decrypt.

---

## Quick start

### 0) Prerequisites
- Node **22** (Hardhat + Next; the repo was built on Node 22 via `nvm use 22`).
- A **funded Fuji** deployer key — [faucet](https://core.app/tools/testnet-faucet).

### 1) Contracts — build circuits & deploy to Fuji

```bash
cd contracts/EncryptedERC
npm install                                   # compiles contracts, builds 5 circuits (downloads circom + ptau)
cp .env.example .env                          # then set PRIVATE_KEY=0x... (funded on Fuji)
npx hardhat run scripts/deploy-xorr.ts --network fuji
```

This deploys the production verifiers, BabyJubJub, the Registrar and a **standalone
EncryptedERC** ("XORR Private USD" / **xUSD**, 2 decimals), then writes every
address to `deployments/fuji.json`. Copy the `encryptedERC` address.

> The circuit artifacts (`*.wasm` / `*.zkey`) are already copied into
> `web/public/circuits/`. If you rebuild them, re-copy from
> `contracts/EncryptedERC/zkit/artifacts/circom/*`.

### 2) Frontend

```bash
cd web
npm install --legacy-peer-deps               # SDK declares a stale wagmi-v1 peer range
cp .env.local.example .env.local             # set NEXT_PUBLIC_EERC_ADDRESS=<encryptedERC from step 1>
npm run dev                                   # http://localhost:3000
```

### 3) Use it
Connect a Fuji wallet → **Register** (one-time BabyJubJub key) → **Generate decryption key**
→ **Mint** test xUSD → **Pay** privately to another registered address → **Withdraw** (burn).
Set an **auditor** on the Compliance page to demo selective disclosure.

---

## How it works (eERC)

1. **Register** — each user registers a BabyJubJub public key in the `Registrar` (a zk proof).
2. **Decryption key** — derived deterministically from a wallet signature; balances
   are decrypted **locally**, never on a server.
3. **Operations** — `privateMint` / `privateTransfer` / `privateBurn` each generate a
   Groth16 proof client-side; the contract stores only **ciphertext** and **verifies** the proof.
4. **Compliance** — the owner sets an auditor (`setAuditorPublicKey`); the auditor
   wallet calls `auditorDecrypt()` to read history.

Notes & docs: the `avalanche-privacy-skills` collection
(`npx skills add nickthelegend/avalanche-privacy-skills`).

---

## Tested & live on Fuji

**Contract test suite** (`cd contracts/EncryptedERC && npx hardhat test test/xorr-*.ts`) — real zk proofs, local network:

| Test | Proves |
|---|---|
| `test/xorr-flow.ts` | mint 100 xUSD → Alice, Alice privately pays Bob 30, Bob withdraws (burn) 10 — balances decrypt correctly |
| `test/xorr-bridge.ts` | lock 50 USDC → relayer mints 50 private xUSD; burn 20 xUSD → relayer releases 20 USDC; replay-guarded |
| `test/xorr-swap.ts` | public AMM swap (50 USDC → XAV) **and** confidential swap (burn xUSD → relayer swaps → output to a fresh address) |

→ **4 passing.**

**Live on Fuji** (real Snowtrace txs):
- Deposit + pay to a different wallet — [mint→Alice](https://testnet.snowtrace.io/tx/0xa3a3b767a05baa3bc68d969709801ecf5150f89e52eca60caa400ed1d60874d8), [Alice→Bob confidential](https://testnet.snowtrace.io/tx/0x5de968517cb57525b4839b68c91cd4052e9c89a824f752b05507b84d1e615e5c) (`scripts/live-mint-pay.ts`)
- AMM swap 100 USDC → 98.71 XAV — [tx](https://testnet.snowtrace.io/tx/0x4853f36c1c227d252cbd3c668ceb396ab8d2a02b963623c0770f95af25ba63e8)
- Bridge in (Fuji escrow) — [lock 40 USDC](https://testnet.snowtrace.io/tx/0x0b120dbb80498594061bf0c2d62e4e3ff15c6db9370e707deae76b60677e9d2f) → [relayer minted 40 xUSD](https://testnet.snowtrace.io/tx/0xfa7aad528114458db437aa98c9bb7de5a2ec975487fd059837143cfaffc374aa) (`scripts/live-bridge.ts`)

**Genuine cross-chain — Ethereum Sepolia → Avalanche Fuji** (`scripts/live-xchain-bridge.ts`):
- [lock 25 USDC on **Sepolia**](https://sepolia.etherscan.io/tx/0xa4a10f825e75ed0e541eab968fc6795cec3ae5e9f03b8d37ee9e4eac4270e8cc) → relayer → [mint 25 xUSD on **Fuji**](https://testnet.snowtrace.io/tx/0x3a14dcd4d020e82fa539dce995bda6739119c604a64ca2757431d77e71d33011) → recipient decrypts 25.00 xUSD. Source escrow on Sepolia: `0x456F03102D45305121d695FAC0fC664a98b257a5`.
- Run it yourself: `deploy-sepolia-bridge.ts --network sepolia`, then the watcher `relayer-xchain.ts --network fuji`, then lock on Sepolia.

**DeFi contracts** (`contracts/xorr/`, deployed via `scripts/deploy-xorr-defi.ts`):
- `XorrBridge.sol` — source-side escrow (lock-and-mint / burn-and-release, nullifier-guarded)
- `XorrAMM.sol` — constant-product AMM (x·y=k, 0.3% fee)
- **Bridge relayer**: `npx hardhat run scripts/relayer.ts --network fuji` watches `Locked` events and privateMints xUSD to recipients.

The **Bridge** and **Swap** tabs in the web app are wired to these live contracts (mint test tokens, quote, approve, swap, lock) via wagmi.

## Notes

- **Standalone mode**: mint is owner-gated. The deploying wallet can self-mint test
  xUSD; otherwise the issuer mints to a registered address.
- **Verifiers must match the hosted circuits.** We build circuits locally (`zkit`)
  and host those (dev) zkeys, so the deploy uses matching dev verifiers. Set
  `PROD_VERIFIERS=true` only if you host AvaCloud's official prod artifacts.
- **Roadmap pages** (Swap, Bridge, Off-ramp, Solvency, Markets, Claim) keep the
  premium UI and are clearly marked — they carry over from the Stellar build and
  map onto eERC (confidential transfer + venue, converter-mode deposits, threshold
  proofs) but aren't wired yet.
- Testnet only · not audited.
