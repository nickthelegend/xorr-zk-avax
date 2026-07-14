// XORR Payroll — compliance (auditor) layer.
//
// Confidential-payroll amounts are hidden on-chain behind commitments. For regulated
// use, a designated compliance officer must still be able to reconstruct the full run.
// Each slot therefore carries an ECIES cipher — the amount (+ metadata) encrypted to the
// auditor's public key — stored as opaque bytes on-chain. Only the auditor's private key
// can decrypt it; the public sees nothing.
//
// Scheme: ephemeral secp256k1 ECDH → HKDF-SHA256 → XChaCha20-Poly1305 (AEAD).
// Blob layout: ephPub(33) ‖ nonce(24) ‖ ciphertext+tag.
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bytesToHex, hexToBytes, type Hex } from "viem";

const INFO = new TextEncoder().encode("xorr-payroll-compliance-v1");

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function kdf(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, new Uint8Array(0), INFO, 32);
}

export interface AuditorKey {
  priv: Hex; // keep secret — the compliance officer's key
  pub: Hex; // compressed (33 bytes) — shared with the employer
}

/** Generate a fresh compliance/auditor keypair. */
export function newAuditorKey(): AuditorKey {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, true); // compressed
  return { priv: bytesToHex(priv), pub: bytesToHex(pub) };
}

/** Derive the auditor public key from a private key (for pasting a key back in). */
export function auditorPubFromPriv(priv: Hex): Hex {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(priv), true));
}

/** What each slot's compliance blob wraps. */
export interface ComplianceRecord {
  email: string;
  amount: string; // human USDC string
  salt: Hex; // the commitment salt (so the auditor can independently re-derive the commit)
}

/** Encrypt a record to the auditor's public key → opaque on-chain bytes. */
export function encryptToAuditor(auditorPub: Hex, rec: ComplianceRecord): Hex {
  const eph = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(eph, true); // 33
  const shared = secp256k1.getSharedSecret(eph, hexToBytes(auditorPub)); // 33 (compressed)
  const key = kdf(shared);
  const nonce = randomBytes(24);
  const pt = new TextEncoder().encode(JSON.stringify(rec));
  const ct = xchacha20poly1305(key, nonce).encrypt(pt);
  const out = new Uint8Array(ephPub.length + nonce.length + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, ephPub.length);
  out.set(ct, ephPub.length + nonce.length);
  return bytesToHex(out);
}

/** Decrypt one slot's compliance blob with the auditor's private key. Returns null if the
 *  key doesn't match (wrong auditor / tampered blob). */
export function decryptAsAuditor(auditorPriv: Hex, blob: Hex): ComplianceRecord | null {
  try {
    const bytes = hexToBytes(blob);
    if (bytes.length < 33 + 24 + 16) return null;
    const ephPub = bytes.slice(0, 33);
    const nonce = bytes.slice(33, 57);
    const ct = bytes.slice(57);
    const shared = secp256k1.getSharedSecret(hexToBytes(auditorPriv), ephPub);
    const key = kdf(shared);
    const pt = xchacha20poly1305(key, nonce).decrypt(ct);
    return JSON.parse(new TextDecoder().decode(pt)) as ComplianceRecord;
  } catch {
    return null;
  }
}
