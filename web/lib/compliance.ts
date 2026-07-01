// Selective disclosure (compliance): a holder generates ZK proofs that they own
// specific on-chain notes worth specific amounts — for an auditor / proof-of-funds —
// WITHOUT revealing spend keys, blindings, or their other notes. The auditor
// verifies the bundle off-chain (snarkjs) and checks the commitments are on-chain.
import { groth16 } from "snarkjs";
import { sha256 } from "@noble/hashes/sha256";
import { Note, deriveViewKey } from "./notes";
import { fromBytes32 } from "./poseidon";

const WASM = "/circuits/disclose.wasm";
const ZKEY = "/circuits/disclose.zkey";
const VKEY = "/circuits/disclose.vkey.json";

/** Field-encode an auditor/session label so the proof is bound to it. */
export function auditorTag(label: string): bigint {
  const t = sha256(new TextEncoder().encode(`audit:${label}`));
  t[0] &= 0x1f; // < r
  return fromBytes32(t);
}

export interface DisclosureItem {
  commitment: string;
  amount: string;
  proof: any;
  publicSignals: string[];
}
export interface DisclosureBundle {
  viewKey: string;
  auditorTag: string;
  total: string;
  items: DisclosureItem[];
}

/** Holder side: prove ownership + amount of each (unspent) note. */
export async function generateDisclosure(
  master: bigint,
  notes: Note[],
  label: string,
  log: (m: string) => void = () => {},
): Promise<DisclosureBundle> {
  const tag = auditorTag(label);
  const items: DisclosureItem[] = [];
  let total = 0n;
  for (const n of notes) {
    if (n.spent) continue;
    const amount = BigInt(n.amount);
    log(`Proving note ${n.commitment.slice(0, 8)}… (${amount})`);
    const { proof, publicSignals } = await groth16.fullProve(
      { commitment: BigInt(n.commitment), amount, auditorTag: tag, sk: BigInt(n.sk), blinding: BigInt(n.blinding) },
      WASM, ZKEY,
    );
    items.push({ commitment: n.commitment, amount: amount.toString(), proof, publicSignals });
    total += amount;
  }
  return { viewKey: deriveViewKey(master).toString(), auditorTag: tag.toString(), total: total.toString(), items };
}

/** Auditor side: verify every disclosure proof and re-total. Optionally checks
 *  each commitment is present in the on-chain leaf set (`onChainLeaves`). */
export async function verifyDisclosure(
  bundle: DisclosureBundle,
  onChainLeaves?: Set<string>,
): Promise<{ ok: boolean; verified: number; total: bigint; onChain: boolean }> {
  const vkey = await (await fetch(VKEY)).json();
  let verified = 0, total = 0n, onChain = true;
  for (const it of bundle.items) {
    const ok = await groth16.verify(vkey, it.publicSignals, it.proof);
    // public signals = [commitment, amount, auditorTag]
    const boundTag = it.publicSignals[2] === bundle.auditorTag;
    const amountMatches = it.publicSignals[1] === it.amount;
    if (!ok || !boundTag || !amountMatches) continue;
    if (onChainLeaves && !onChainLeaves.has(it.commitment)) { onChain = false; continue; }
    verified++;
    total += BigInt(it.amount);
  }
  return { ok: verified === bundle.items.length && verified > 0, verified, total, onChain };
}
