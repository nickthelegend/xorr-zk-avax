# XORR — Hackathon submission (copy-paste answers)

---

## GENERAL SECTION

### Project name
```
XORR
```

### Short and engaging overview
```
Private-by-default money on Avalanche. Hold, send, swap, bridge and run payroll
in xUSD with balances and amounts encrypted on-chain via eERC — every operation
proven by a zk-SNARK, all crypto client-side. Private, not anonymous: a rotatable
auditor can decrypt for compliance, so it's regulator-ready by construction.
```

### Describe your project in detail
```
THE PROBLEM

Public blockchains leak everything about money. Your salary, your runway, your
counterparties, your trading size — all permanently readable by anyone with your
address. That single property is why serious businesses don't run treasury or
payroll on-chain. The usual fix is anonymity (mixers), which solves privacy by
making compliance impossible and gets the whole category banned. The real
requirement isn't "nobody can see" — it's "the public can't see, but an auditor
can."

WHAT XORR IS

XORR is a private-by-default money app on Avalanche built on eERC (Encrypted
ERC), where balances and transfer amounts are ciphertext on-chain (BabyJubJub +
ElGamal + Poseidon, proven with Groth16). All cryptography runs client-side in
the browser; the contract only verifies. There are no relayers — everything
settles fully on-chain.

Crucially, every eERC operation encodes an auditor PCT: a designated, rotatable
auditor can selectively decrypt the full history for compliance, without
weakening anyone else's privacy and without a redeploy when the key rotates.
That is the whole thesis — private, not anonymous.

WHAT YOU CAN ACTUALLY DO (all live on Fuji)

  1. CONFIDENTIAL MONEY — register a BabyJubJub key, privateMint xUSD, send a
     privateTransfer where the amount is ciphertext on-chain, privateBurn to exit.

  2. COMPLIANCE — the owner sets an auditor; the auditor decrypts the full
     transaction history. Selective disclosure that actually works, on-chain.

  3. CROSS-CHAIN BRIDGE — lock USDC on another EVM chain, a relayer privateMints
     confidential xUSD on Fuji. Proven end-to-end Sepolia → Fuji: 25 USDC locked
     on Sepolia, 25 xUSD minted on Fuji, recipient decrypted 25.00.

  4. CONFIDENTIAL SWAP — XorrAMM (constant product x·y=k): a private swap burns
     xUSD and routes the output to a fresh, unlinked address, so the trade can't
     be tied back to the payer.

  5. CONFIDENTIAL PAYROLL — the flagship business use case. An employer funds one
     batch; each employee claims via a claim link. Two modes:
       • PayrollEscrow — claim-link batch payout with an anti-front-running
         signature so a claim link can't be sniped from the mempool.
       • ConfidentialPayroll — per-employee amounts are hidden as commitments,
         with encrypted compliance ciphers alongside. The public sees that a
         payroll ran; it cannot see who earns what. The auditor decrypts the
         whole run.
     This is the thing companies actually can't do on a public chain today —
     nobody will put salaries on-chain in plaintext.

  6. COMPLIANCE ATTESTATION — ComplianceRegistry records an on-chain, signed
     attestation that a payroll run was verified: the report's commitments were
     checked against the on-chain run, hashed, and signed. There's a standalone
     Verify view so a third party can independently confirm a report matches
     what actually happened on-chain.

DEPLOYED ON AVALANCHE FUJI (43113)

  eERC core
    EncryptedERC          0xe4c10B6Cd5364B79d1136a35c1CD4b4f46f6574A
    Registrar             0xB51479e60CC36810836972BCDEeFFdeec09004Db
    BabyJubJub            0xba675F27dF7F59D5e547Ee82F691b903eAC23581
    Verifiers (registration / mint / transfer / withdraw / burn) — all deployed
  XORR layer
    XorrAMM               0x1A0236a0Fb5Ef1944F0200D62414A5366b0477E8
    XorrBridge            0x7e4499a2CD65821F205B43aF6c4313293D4E95C1
    PayrollEscrow         0xb21a4dFb906efad3C51154a462edE2E8201c5c7f
    ConfidentialPayroll   0xe8f78cE3d4F350809f32bAdA1C0c3878a82020C3
    ComplianceRegistry    0x17fC9Fe9fB74a03aE2cab4ad829F80Cc350258e1
  Source escrow on Sepolia  0x456F03102D45305121d695FAC0fC664a98b257a5

TESTS (all green)
  contracts/EncryptedERC (Hardhat)  144/144 — real ZK proofs, ~45s
  web (Node test runner via tsx)     51/51
  plus live on-chain runs on Fuji for mint, private transfer, bridge, and swap.

HONEST SCOPE

Testnet only, unaudited. The bridge relayer is a trusted operator today
(decentralising it is the follow-up). Everything described above is real,
deployed, and verifiable on Snowtrace — no mocked flows.
```

### Select tracks
```
Privacy / eERC  (primary — built directly on Avalanche's Encrypted ERC)
+ any DeFi track (confidential AMM swap + cross-chain bridge)
+ any RWA / payments / enterprise track (confidential payroll + compliance attestation)
```
> Pick these from the event's actual list. eERC/Privacy is the core fit.

---

## TECHNICAL DETAILS

### Describe the tech stack, APIs, and integrations used. Mention any innovative solutions or "hacky" parts worth highlighting.
```
STACK

  Chain        Avalanche Fuji C-Chain (43113)
  Privacy      eERC (Encrypted ERC, AvaCloud) — BabyJubJub + ElGamal + Poseidon,
               Groth16 zk-SNARKs, client-side proving, no relayers
  SDK          @avalabs/ac-eerc-sdk (browser proving)
  Contracts    Solidity — ava-labs/EncryptedERC upstream + our contracts/xorr/
               (XorrBridge.sol, XorrAMM.sol, PayrollEscrow.sol,
                ConfidentialPayroll.sol, ComplianceRegistry.sol) — Hardhat
  Frontend     Next.js (App Router) + TypeScript + wagmi + viem
  Crypto (app) secp256k1 ECIES compliance library for encrypted payroll ciphers

HOW WE USE eERC — EXACTLY AS INTENDED, PLUS A PRODUCT LAYER

We deploy eERC in standalone mode (a new private token, xUSD, with hideable
supply) using the official ava-labs/EncryptedERC contracts, and drive the full
lifecycle from the browser: register → generateDecryptionKey → privateMint →
privateTransfer → privateBurn, with setAuditorPublicKey / auditorDecrypt for
compliance. Every proof is generated client-side; the chain only verifies. Then
we build the things a real user needs on top: a bridge in, a swap, payroll, and
attestation.

THE INTERESTING ENGINEERING

1. CONFIDENTIAL PAYROLL WITH A REAL COMPLIANCE PATH
   Hiding salaries is easy; hiding them in a way an auditor can still verify is
   the hard part. Per-employee amounts are stored as commitments, with encrypted
   compliance ciphers alongside. We wrote an ECIES (secp256k1) library so the
   auditor — and only the auditor — decrypts the full run. Then ComplianceRegistry
   binds an attestation to that specific run's auditor and refuses overwrite, so
   an attestation can't be silently replaced with a friendlier one later.

2. ANTI-FRONT-RUNNING ON CLAIM LINKS
   A claim-link payout is a race: the link is a bearer credential, and a bot
   watching the mempool can front-run the legitimate claimer. We bind each claim
   to a signature so the transaction can only be executed by the intended
   recipient — the link alone isn't enough to steal the payout.

3. UNLINKABLE SWAP OUTPUT
   A confidential swap that pays back to the same address leaks the link. Ours
   burns xUSD and routes the AMM output to a fresh address, so the input and
   output aren't trivially connected.

4. END-TO-END CIPHERTEXT PAYOUT
   Payroll pays out via eERC privateMint, so the payout amount is ciphertext at
   the token layer too — not just hidden in our contract's storage — and the
   native eERC auditor path covers it.

THE HACKY PART WORTH HIGHLIGHTING

This is a port of XORR from Stellar, and the privacy engine changed completely.
The Stellar version was a hand-rolled BN254 Groth16 shielded-note system: we
wrote the notes, the Merkle tree, the nullifiers, the circuits — all of it. On
Avalanche, eERC provides encrypted balances natively, so the right move was to
delete our custom ZK plumbing rather than port it. The migration was therefore a
re-engineering, not a translation: shield→privateMint, spend-notes→privateTransfer,
unshield→privateBurn, and our bespoke "selective disclosure receipt" was replaced
by eERC's native rotatable auditor, which is strictly better because it doesn't
require the user to cooperate to produce a receipt. The premium XORR UI was kept
intact — only the engine underneath changed.

The other genuinely fiddly bit: eERC's deployed token uses 2 decimals, and the
app brands the shielded representation as xUSD. Getting decimals, encrypted
balance decoding, and UI formatting consistent across mint/transfer/burn/bridge/
swap/payroll — where a wrong scale factor produces a plausible-but-wrong number
rather than an error — needed its own tests.
```

### Select the technologies you used
```
Solidity · TypeScript · Next.js · React · Hardhat · wagmi · viem · Node.js ·
eERC (Encrypted ERC) · @avalabs/ac-eerc-sdk · Groth16 zk-SNARKs · BabyJubJub ·
ElGamal · Poseidon · secp256k1 / ECIES · Avalanche (Fuji C-Chain) · Ethereum Sepolia
```

### GitHub link
```
https://github.com/nickthelegend/xorr-zk-avax
```

### Project links
```
https://github.com/nickthelegend/xorr-zk-avax
https://testnet.snowtrace.io/address/0xe4c10B6Cd5364B79d1136a35c1CD4b4f46f6574A
https://testnet.snowtrace.io/address/0xe8f78cE3d4F350809f32bAdA1C0c3878a82020C3
```
> Add your demo-video URL and the live app URL if you deploy the web app.

---

## PROJECT CONTINUITY & DEVELOPMENT

### Is your project built upon an existing idea? — YES. Full disclosure:
```
PRE-EXISTING (built before this hackathon)

XORR previously existed as a Stellar/Soroban project
(github.com/nickthelegend/xorr-zk-stellar) — confidential money on Stellar using
a hand-rolled BN254 Groth16 shielded-note system. What carried over is the
product concept (private-by-default money with selective disclosure) and the
premium XORR user interface design.

BUILT DURING THIS HACKATHON (everything below is new work)

1. ENTIRE PRIVACY ENGINE REPLACED — Soroban shielded notes → eERC
   The custom note/Merkle/nullifier system was removed, and the confidential
   layer rebuilt on Avalanche's Encrypted ERC using the official ava-labs
   contracts: standalone xUSD deployed to Fuji with the full verifier set,
   Registrar, and BabyJubJub. New deploy scripts, new Fuji configuration.

2. FRONTEND RE-ENGINED STELLAR → AVALANCHE
   Every chain touchpoint is new: wallet/provider, registration,
   generateDecryptionKey, privateMint, privateTransfer, privateBurn, and the
   auditor flows — rewritten against @avalabs/ac-eerc-sdk with wagmi/viem. The UI
   design was preserved; the engine beneath it is entirely new code.

3. CROSS-CHAIN BRIDGE — NEW
   XorrBridge.sol (lock-and-mint) written, deployed, and proven end-to-end
   Sepolia → Fuji with a live relayer run.

4. CONFIDENTIAL SWAP — NEW
   XorrAMM.sol (constant-product) written and deployed; private swap burns xUSD
   and routes output to a fresh unlinked address. Live swap executed on Fuji.

5. CONFIDENTIAL PAYROLL SUITE — ENTIRELY NEW (did not exist on Stellar)
   • PayrollEscrow.sol — claim-link batch payroll with anti-front-running signature
   • ConfidentialPayroll.sol — hidden per-employee amounts via commitments plus
     encrypted compliance ciphers
   • A secp256k1 ECIES compliance library so the auditor decrypts a full run
   • End-to-end ciphertext payout through eERC privateMint
   • Full payroll + claim + compliance UI

6. COMPLIANCE ATTESTATION — ENTIRELY NEW
   ComplianceRegistry.sol for on-chain signed attestation of a verified run
   (bound to the run's auditor, no overwrite), a report generate/verify library,
   and a standalone third-party Verify view.

7. FULL TEST SUITE — NEW
   144/144 contract tests (real ZK proofs) and 51/51 web tests, plus live
   on-chain verification runs on Fuji.

8. SECURITY HARDENING PASS
   An adversarial edge-case review of every new contract (payroll, compliance,
   bridge, AMM) produced fixes — address(0) guards, fee-delta handling,
   attestation-overwrite prevention — which were implemented and redeployed
   during the hackathon. The addresses listed above are the hardened redeploys.

SUMMARY: the product concept and the UI design are pre-existing; the entire
Avalanche implementation — the eERC privacy engine, the rewritten frontend, the
bridge, the AMM, the whole confidential-payroll and compliance-attestation suite,
and all tests — was built during this hackathon. The payroll and compliance
features are new product surface that never existed in any earlier version.
```
