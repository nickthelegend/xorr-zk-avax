# XORR Payroll — Roadmap

**Encrypted payroll on Avalanche.** An employer funds a batch of payments once; each
recipient gets a private, email-delivered **claim link** and pulls their pay into any
wallet — no recipient wallet needed up front, no salaries doxxed to a public address list.

Built on XORR's existing eERC/Fuji stack. Lives as a new **Payroll** tab on the home
screen, alongside Deposit / Pay / Swap / Bridge.

---

## Why claim links (the core idea)

You can't `privateTransfer` to an email — eERC needs a registered BabyJubJub key. So
payroll uses a **claim-link escrow** (the "Peanut" pattern):

1. For each recipient the employer generates a fresh throwaway **claim keypair**. Only the
   claim *address* goes on-chain; the claim *private key* is the secret in the link.
2. The employer escrows the batch in one `createPayroll` tx (one ERC-20 `approve` + one call).
3. The recipient opens their link, connects any wallet, and the claim key (in the URL,
   never on-chain) **signs their chosen payout address**. The contract verifies the
   signature and releases the funds.

**Front-running-safe:** the signature commits to `(contract, chainId, payrollId, slot,
payoutAddress)`. A bot that sees the claim in the mempool can't redirect it — changing the
payout address invalidates the signature, and it can't forge a new one without the claim key.

**Private by construction:** the on-chain record is just ephemeral claim addresses +
amounts. The employee↔email↔salary mapping never touches the chain.

---

## Phase 1 — Claim-link escrow (v1) ✅ *this milestone*

- [x] `PayrollEscrow.sol` — `createPayroll(token, claimAddrs[], amounts[], expiry)`,
      `claim(id, slot, to, sig)`, `reclaim(id, slot)` after expiry, full view surface.
- [x] Anti-front-run claim-key signature bound to `(this, chainId, id, slot, to)`.
- [x] Unit tests (create / claim / double-claim / bad-sig / front-run resistance /
      reclaim / accounting / reverts) — all green.
- [x] Integration test — full create → emailed-key-sign → claim, real signatures, balances.
- [x] **Payroll tab** + batch builder (rows of `email, amount`) → fund → per-email claim links.
- [x] `/payroll/claim` page — read claim key from URL, connect wallet, sign, claim.
- [x] Token: public test **USDC** (the same faucet token as Bridge/Swap). Amounts are
      visible on-chain in v1; recipient identities are not.

## Phase 2 — Confidential amounts + compliance ✅ *done*

`ConfidentialPayroll.sol` (Fuji `0xf13e2A0631C9c52124DCaE61103137341729FE03`) — the
**Confidential** sub-tab on Payroll.

- [x] Per-slot amount **commitments** `keccak256(amount, salt)` — the salary split is never
      published as a list; only commitments + the funded pool total appear on-chain.
- [x] Each recipient's `(amount, salt)` lives in their private link; the claim signature binds
      `(this, chainId, id, slot, to, amount, salt)` — front-run-safe *and* amount-tamper-safe
      (`BadCommit` / `BadSignature`).
- [x] **Compliance** — each slot carries an ECIES blob (secp256k1 ECDH → HKDF-SHA256 →
      XChaCha20-Poly1305) encrypting the amount to a compliance/auditor key. The auditor
      decrypts the full run in-browser for reporting; the public sees only commitments.
      `web/lib/compliance.ts`, tested (round-trip, wrong-key + tamper rejection, full-run).
- [x] Tests: 11 Hardhat (commit/claim/bad-commit/front-run/sweep/pool-accounting) + 7 ECIES
      + live Fuji UI e2e (fund → auditor decrypt → claim). All green.
- [ ] *Next:* route the payout itself through the eERC (`privateMint`/`privateTransfer`) so
      the amount is ciphertext end-to-end — today the USDC transfer still reveals an amount at
      claim time; commitments hide the pre-claim split and compliance stays auditable.

## Phase 3 — Delivery & UX

- [ ] One-click `mailto:` per recipient (v1 already generates copyable links + mailto).
- [ ] Optional email relay (SendGrid/Resend) behind an opt-in server action — never
      auto-send without explicit confirmation.
- [ ] CSV import for the recipient batch; per-recipient claim status dashboard.
- [ ] Recurring runs (save a roster, re-fund monthly).

## Phase 4 — Compliance & scale

- [ ] Auditor view (reuse eERC auditor key) — selective disclosure of a run to a regulator.
- [ ] Batch limits / gas profiling for large rosters; multicall claim.
- [ ] Streaming payroll (per-second vesting) as an alternative to lump claims.

---

## Contract surface (v1)

```
createPayroll(IERC20 token, address[] claimAddrs, uint128[] amounts, uint64 expiry) → id
claim(uint256 id, uint256 slot, address to, bytes signature)
reclaim(uint256 id, uint256 slot)                 // employer, after expiry, unclaimed only
claimDigest(uint256 id, uint256 slot, address to) → bytes32   // what the claim key signs
payrollCount() / slotCount(id) / getPayroll(id) / getSlot(id, i)
```

Events: `PayrollCreated`, `Claimed`, `Reclaimed`. Errors are typed (custom errors).
