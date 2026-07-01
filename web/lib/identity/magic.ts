// Magic.link provider — PRODUCTION STUB.
//
// Magic does passwordless email/social login with per-user HSM-isolated keys
// (@magic-sdk + the Stellar extension). Like Web3Auth, key material is held by
// the provider's HSMs rather than a single KMS_MASTER, which is a stronger
// custody posture — but it ALSO cannot derive a recipient's key from their email
// before they log in, so `resolveRecipient` must degrade to an escrow/claim flow
// keyed by the salted emailHash. See web3auth.ts for the same limitation.
import type { IdentityWalletProvider } from "./types";

const NOT_IMPL = "Magic provider not configured — set IDENTITY_PROVIDER=selfhosted or implement magic.ts";

export class MagicProvider implements IdentityWalletProvider {
  readonly id = "magic";
  resolveRecipient(): never { throw new Error(NOT_IMPL); }
  getMyIdentity(): never { throw new Error(NOT_IMPL); }
  ensureStellarAccount(): never { throw new Error(NOT_IMPL); }
  signTx(): never { throw new Error(NOT_IMPL); }
  notify(): never { throw new Error(NOT_IMPL); }
}
