// Poseidon hash + field helpers.
//
// circomlibjs' Poseidon operates over the BN254 scalar field — the same field
// the circuits are compiled in (circom's default bn128) AND the field the
// on-chain verifier checks (CAP-0074 BN254 host functions). So commitments,
// nullifiers, the Merkle tree, the circuit witnesses, and on-chain verification
// all agree with zero cross-field conversion. This is why the curve choice
// matters: it's what makes the whole pipeline line up end-to-end.
import { buildPoseidon } from "circomlibjs";

type PoseidonFn = {
  (inputs: (bigint | number | string)[]): Uint8Array;
  F: { toObject(x: Uint8Array): bigint };
};

let _poseidon: PoseidonFn | null = null;

export async function ready(): Promise<void> {
  if (!_poseidon) _poseidon = (await buildPoseidon()) as PoseidonFn;
}

/** Poseidon hash of field elements -> field element (bigint). */
export function poseidon(inputs: (bigint | number | string)[]): bigint {
  if (!_poseidon) throw new Error("poseidon not initialized — call ready() first");
  return _poseidon.F.toObject(_poseidon(inputs.map((x) => BigInt(x))));
}

/** Big-endian 32-byte encoding of a field element (for BytesN<32> args). */
export function toBytes32(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function fromBytes32(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Cryptographically random field element. */
export function randomField(): bigint {
  const buf = new Uint8Array(31); // < BN254/BLS field order
  crypto.getRandomValues(buf);
  return fromBytes32(new Uint8Array([0, ...buf]));
}
