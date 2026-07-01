// In-browser Groth16 proving via snarkjs, plus conversion of the resulting
// proof into the Soroban `Proof` byte encoding (see circuits/scripts/export-vk.mjs).
import { groth16 } from "snarkjs";
import { xdr } from "@stellar/stellar-sdk";

export type CircuitName = "deposit" | "transfer" | "withdraw" | "solvency";

export interface SorobanProof {
  a: Uint8Array; // 96
  b: Uint8Array; // 192
  c: Uint8Array; // 96
}

// BN254 (CAP-0074) point encoding for soroban_sdk::crypto::bn254:
//   Fp           : 32 bytes, big-endian
//   G1Affine (64): be(x) || be(y)
//   G2Affine(128): be(x) || be(y), each Fp2 = be(c1) || be(c0)  (imaginary
//                  first, EIP-197 order). snarkjs lists Fp2 as [c0, c1], so we
//                  swap when serializing each coordinate.
const FP = 32;

function fpBytes(dec: string): Uint8Array {
  let v = BigInt(dec);
  const out = new Uint8Array(FP);
  for (let i = FP - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) (out.set(x, o), (o += x.length));
  return out;
};

const g1 = (p: string[]) => concat(fpBytes(p[0]), fpBytes(p[1]));
// p[i] = [c0, c1] from snarkjs -> emit be(c1) || be(c0).
const fp2 = (c: string[]) => concat(fpBytes(c[1]), fpBytes(c[0]));
const g2 = (p: string[][]) => concat(fp2(p[0]), fp2(p[1]));

/** artifacts served from /public/circuits/<name>.{wasm,zkey} */
const wasmUrl = (c: CircuitName) => `/circuits/${c}.wasm`;
const zkeyUrl = (c: CircuitName) => `/circuits/${c}.zkey`;

export async function artifactsAvailable(c: CircuitName): Promise<boolean> {
  try {
    const r = await fetch(zkeyUrl(c), { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

/** Generate a proof and return both the Soroban-encoded proof and the public signals. */
export async function prove(
  circuit: CircuitName,
  input: Record<string, unknown>,
): Promise<{ proof: SorobanProof; publicSignals: string[] }> {
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    wasmUrl(circuit),
    zkeyUrl(circuit),
  );
  return {
    proof: { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) },
    publicSignals,
  };
}

/** Build the ScVal for the contract `Proof { a, b, c }` struct. */
export function proofToScVal(p: SorobanProof): xdr.ScVal {
  const entry = (k: string, v: Uint8Array) =>
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(k),
      val: xdr.ScVal.scvBytes(Buffer.from(v)),
    });
  return xdr.ScVal.scvMap([entry("a", p.a), entry("b", p.b), entry("c", p.c)]);
}
