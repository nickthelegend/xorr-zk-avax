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
| ETH→Stellar bridge, SEP-24 off-ramp, money market, ZK swaps | **Roadmap** (premium UI kept, wiring in progress) |

**Private, not anonymous.** Every eERC op encodes an *auditor PCT*; the designated
auditor can selectively decrypt the full history for compliance — without
weakening anyone else's privacy, and without a redeploy when the key rotates.

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

## Notes

- **Standalone mode**: mint is owner-gated. The deploying wallet can self-mint test
  xUSD; otherwise the issuer mints to a registered address.
- **Roadmap pages** (Swap, Bridge, Off-ramp, Solvency, Markets, Claim) keep the
  premium UI and are clearly marked — they carry over from the Stellar build and
  map onto eERC (confidential transfer + venue, converter-mode deposits, threshold
  proofs) but aren't wired yet.
- Testnet only · not audited.
