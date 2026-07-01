// Web3Auth / MetaMask Embedded Wallets provider — PRODUCTION STUB.
//
// Web3Auth does social/email login → an MPC-managed key (non-custodial-ish), and
// is chain-agnostic, so the derived private key can seed a Stellar account. To
// wire it: use @web3auth/modal to log in, get the user's private key, derive the
// shielded master + Stellar key from it (replacing /api/identity/me), and the
// MPC network — not a single KMS_MASTER — holds the key shares.
//
// IMPORTANT LIMITATION: MPC/HSM providers have NO "derive someone else's key
// from their email before they log in" primitive. So `resolveRecipient` cannot
// be deterministic here — a real Web3Auth integration must fall back to an
// ESCROW/claim-code flow: post the encrypted note under a salted emailHash and
// let the recipient claim it after first login. The self-hosted provider's
// pre-login resolve is unique to its deterministic (and therefore custodial)
// derivation. Document this tradeoff when switching providers.
import type { IdentityWalletProvider } from "./types";

const NOT_IMPL = "Web3Auth provider not configured — set IDENTITY_PROVIDER=selfhosted or implement web3auth.ts";

export class Web3AuthProvider implements IdentityWalletProvider {
  readonly id = "web3auth";
  resolveRecipient(): never { throw new Error(NOT_IMPL); }
  getMyIdentity(): never { throw new Error(NOT_IMPL); }
  ensureStellarAccount(): never { throw new Error(NOT_IMPL); }
  signTx(): never { throw new Error(NOT_IMPL); }
  notify(): never { throw new Error(NOT_IMPL); }
}
