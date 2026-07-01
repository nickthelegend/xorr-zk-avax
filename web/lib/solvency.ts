// Proof of Solvency / Proof of Funds — Xorr's originality feature.
//
// Prove "I control shielded value >= threshold" without revealing the amount or
// which note. The proof is generated in-browser (snarkjs) and verified ON-CHAIN
// by the generic BN254 Groth16 verifier (CAP-0074), called directly — no pool
// state change, so it needs no signature (read-only simulation).
import { xdr } from "@stellar/stellar-sdk";
import { VERIFIER_ID } from "./config";
import { simulateCall, vecU256 } from "./stellar";
import { prove, proofToScVal } from "./prover";
import { WalletState, buildTree, deriveNullifier } from "./notes";

export interface SolvencyResult {
  verified: boolean;
  thresholdBase: bigint;
  root: bigint;
  nullifier: bigint;
}

interface SorobanVk {
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  ic: string[];
}

let _vk: SorobanVk | null = null;
async function loadVk(): Promise<SorobanVk> {
  if (_vk) return _vk;
  const r = await fetch("/circuits/solvency.vk.soroban.json");
  if (!r.ok) throw new Error("solvency verifying key not found (public/circuits/solvency.vk.soroban.json)");
  _vk = (await r.json()) as SorobanVk;
  return _vk;
}

// VerificationKey struct -> ScVal map. Soroban maps require keys in sorted
// order: alpha, beta, delta, gamma, ic.
function vkToScVal(vk: SorobanVk): xdr.ScVal {
  const b = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
  const e = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  return xdr.ScVal.scvMap([
    e("alpha", b(vk.alpha)),
    e("beta", b(vk.beta)),
    e("delta", b(vk.delta)),
    e("gamma", b(vk.gamma)),
    e("ic", xdr.ScVal.scvVec(vk.ic.map(b))),
  ]);
}

/**
 * Pick an unspent note worth >= `thresholdBase`, prove solvency in zero
 * knowledge, and verify the proof on-chain. Throws if no single note clears the
 * threshold (deposit first, or lower it).
 */
export async function proveSolvency(
  w: WalletState,
  thresholdBase: bigint,
  log: (m: string) => void = () => {},
): Promise<SolvencyResult> {
  const eligible = w.notes.find(
    (n) => !n.spent && n.leafIndex !== undefined && BigInt(n.amount) >= thresholdBase,
  );
  if (!eligible) {
    throw new Error(
      "No single shielded note clears that threshold. Make a deposit first, or lower the threshold.",
    );
  }

  const tree = buildTree(w);
  const { pathElements, pathIndices } = tree.proof(eligible.leafIndex!);
  const root = tree.root;
  const nullifier = deriveNullifier(BigInt(eligible.commitment), BigInt(eligible.sk));

  log(`Generating solvency proof (≥ threshold; amount stays hidden)…`);
  const { proof } = await prove("solvency", {
    root,
    threshold: thresholdBase,
    nullifier,
    amount: BigInt(eligible.amount),
    sk: BigInt(eligible.sk),
    blinding: BigInt(eligible.blinding),
    pathElements,
    pathIndices,
  });

  log("Verifying on-chain via the BN254 Groth16 verifier…");
  const vk = await loadVk();
  const verified: boolean = await simulateCall(VERIFIER_ID, "verify_proof", [
    vkToScVal(vk),
    proofToScVal(proof),
    vecU256([root, thresholdBase, nullifier]),
  ]);

  log(verified ? "Verified ✓ — solvency proven, balance never revealed." : "On-chain verification returned false.");
  return { verified, thresholdBase, root, nullifier };
}
