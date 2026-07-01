// Pure context-binding helpers for selective-disclosure receipts (no proving
// deps, so they're unit-testable in Node). The authority/purpose/nonce context
// is hashed into one BN254 field element that the proof commits to; the verifier
// re-derives it to detect any tampering after the fact.
import { sha256 } from "@noble/hashes/sha256";
import { fromBytes32 } from "./poseidon";

// BN254 scalar field order — context tags must be reduced below this.
export const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface ReceiptContext {
  authority: string; // e.g. "KYC Provider"
  purpose: string;   // e.g. "identity-verification"
  nonce: string;     // 0x… anti-replay nonce
}

/** Bind the authority/purpose/nonce context into a single circuit field element. */
export function contextTag(ctx: ReceiptContext): bigint {
  const s = `disclosure-context-v1|${ctx.authority}|${ctx.purpose}|${ctx.nonce}`;
  const t = sha256(new TextEncoder().encode(s));
  t[0] &= 0x1f; // keep it well below FIELD_R
  return fromBytes32(t) % FIELD_R;
}

/** A fresh 16-byte hex nonce for replay-resistance. */
export function randomNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Pure check: do a receipt's public signals re-derive from this context + note?
 * publicSignals = [commitment, amount, auditorTag(=contextTag)].
 */
export function contextMatches(
  publicSignals: string[] | undefined,
  ctx: ReceiptContext,
  commitment: string,
  amount: string,
): boolean {
  return (
    !!publicSignals &&
    publicSignals[2] === contextTag(ctx).toString() &&
    publicSignals[1] === amount &&
    publicSignals[0] === BigInt(commitment).toString()
  );
}
