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

## Phase 2 — Confidential amounts (eERC)

- [ ] Fund payroll from the employer's **encrypted xUSD** balance instead of public USDC.
- [ ] On claim, deliver into the recipient's **encrypted balance** (auto-register on claim),
      so individual salaries are ciphertext end-to-end — only the employer's total ever
      hinted at, never the split.
- [ ] Per-slot amount commitments (`hash(amount, salt)`) revealed only at claim time.

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
