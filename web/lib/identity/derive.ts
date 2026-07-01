// Deterministic custodial-identity derivation — the cryptographic core of the
// pay-to-email feature.
//
// One server-held root secret (`KMS_MASTER`) plus a canonical identity uid
// (e.g. "email:bob@gmail.com") deterministically yields a user's entire
// constellation of keys:
//   - the shielded `master` (BN254 field element) → spend/view keys + the
//     X25519 delivery key (via the existing `delivery.ts:encKeyPair`),
//   - an independent ed25519 Stellar account key (G…/S…) for submitting txs.
//
// Determinism is the whole trick: a *sender* who only knows the recipient's
// email derives their X25519 `encPub` and routes an encrypted note to it BEFORE
// the recipient has ever logged in. When the recipient later authenticates via
// SSO, the backend re-derives the identical keys and they can decrypt + spend.
//
// SECURITY: `KMS_MASTER` is never bundled into the client. These functions take
// it as an explicit argument; only the backend (`backend/src/derive.mjs`, a
// byte-for-byte mirror of this file) and tests actually hold a value for it.
// Whoever holds `KMS_MASTER` can derive every user's keys — that is the
// custodial trust boundary, documented in AUDIT.md.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { Keypair } from "@stellar/stellar-sdk";
import { encKeyPair, encPubB64 } from "../delivery";

// BN254 scalar field order r — the field circomlibjs/Poseidon and the on-chain
// verifier operate in. The shielded master must live in this field.
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const HKDF_INFO_MASTER = "xorr-shielded-master-v1";
const HKDF_INFO_STELLAR = "xorr-stellar-ed25519-v1";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function beToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

/**
 * Shielded master (a BN254 field element) for an identity. salt = sha256(uid)
 * domain-separates per user; info pins the purpose. Reduced into the field so
 * it's a valid Poseidon input, exactly like `randomField()` produces.
 */
export function deriveMaster(kmsMaster: Uint8Array, uid: string): bigint {
  const okm = hkdf(sha256, kmsMaster, sha256(utf8(uid)), HKDF_INFO_MASTER, 32);
  return beToBigInt(okm) % FIELD;
}

/**
 * Base64 X25519 public key for delivery. MUST equal
 * `encPubB64(encKeyPair(master))` — reused verbatim from delivery.ts so the
 * sender (deriving from email→master) and the recipient (deriving from their
 * own master) compute byte-identical pubkeys.
 */
export function deriveEncPub(master: bigint): string {
  return encPubB64(encKeyPair(master));
}

/** Independent ed25519 Stellar account key for the identity. */
export function deriveStellar(kmsMaster: Uint8Array, uid: string): Keypair {
  const seed = hkdf(sha256, kmsMaster, sha256(utf8(uid)), HKDF_INFO_STELLAR, 32);
  return Keypair.fromRawEd25519Seed(Buffer.from(seed));
}

export interface DerivedIdentity {
  uid: string;
  master: string; // decimal bigint string (shielded root)
  encPub: string; // base64 X25519
  stellarPub: string; // G…
  stellarSecret: string; // S…  (custodial — keep server-side / in-memory only)
}

/** Derive the full custodial identity bundle for a uid. */
export function deriveIdentity(kmsMaster: Uint8Array, uid: string): DerivedIdentity {
  const master = deriveMaster(kmsMaster, uid);
  const kp = deriveStellar(kmsMaster, uid);
  return {
    uid,
    master: master.toString(),
    encPub: deriveEncPub(master),
    stellarPub: kp.publicKey(),
    stellarSecret: kp.secret(),
  };
}
