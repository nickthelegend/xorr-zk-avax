// Provider abstraction for custodial identity. The self-hosted provider is the
// default; Web3Auth (MetaMask Embedded Wallets) and Magic can replace it in
// production by implementing this interface.

export interface ResolvedRecipient {
  encPub: string; // base64 X25519 — what pool.payTo needs
  routeKey: string; // hex(sha256(encPub)) — where the encrypted blob goes
  exists: boolean; // has this identity ever provisioned? (UX hint only)
  emailHashHex?: string | null; // salted email tag (email recipients only)
  uidNorm?: string; // canonical identity (for showing the normalized form)
}

export interface MyIdentity {
  master: string; // shielded root (decimal bigint string)
  encPub: string; // base64 X25519
  stellarPub: string; // G…
  routeKey: string;
}

export interface ClaimResult {
  stellarPub: string;
  funded: boolean;
  trustline: boolean;
}

export interface IdentityWalletProvider {
  readonly id: string;
  /** Sender-side: resolve an email/@handle to a deliverable encPub (pre-login OK). */
  resolveRecipient(emailOrHandle: string): Promise<ResolvedRecipient>;
  /** Recipient-side: this signed-in user's custodial identity. */
  getMyIdentity(): Promise<MyIdentity>;
  /** Recipient-side: fund the Stellar account + trustline so notes are spendable. */
  ensureStellarAccount(): Promise<ClaimResult>;
  /** Sign a Soroban tx XDR with the custodial key (server-side); returns signed XDR. */
  signTx(xdr: string): Promise<string>;
  /** Email the recipient that a payment is waiting. */
  notify(email: string): Promise<void>;
}
