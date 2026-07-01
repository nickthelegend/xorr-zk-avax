// Selective-disclosure RECEIPTS, modelled on NethermindEth/stellar-private-payments.
// A holder proves ownership + amount of ONE unspent note, bound to an auditor
// context (authority · purpose · nonce), and hands the verifier a portable receipt.
// The verifier checks three things independently: the Groth16 proof, that the
// declared context re-derives to the value the proof committed to, and that the
// note's commitment is still in the pool's on-chain leaf set.
import { groth16 } from "snarkjs";
import { type Note, deriveViewKey } from "./notes";
import { NETWORK, POOL_ID } from "./config";
import { type ReceiptContext, contextTag, contextMatches } from "./disclosure-context";

export type { ReceiptContext } from "./disclosure-context";
export { contextTag, randomNonce } from "./disclosure-context";

const WASM = "/circuits/disclose.wasm";
const ZKEY = "/circuits/disclose.zkey";
const VKEY = "/circuits/disclose.vkey.json";

export interface DisclosureReceipt {
  version: 1;
  network: string;
  pool: string;
  context: ReceiptContext;
  note: { commitment: string; amount: string };
  viewKey: string;
  contextTag: string;
  proof: unknown;
  publicSignals: string[];
  issuedAt: string;
}

export interface ReceiptChecks {
  proofValid: boolean;
  contextValid: boolean;
  rootFresh: boolean;
}

/** Holder side: prove ownership + amount of ONE note, bound to the context. */
export async function generateReceipt(
  master: bigint,
  note: Note,
  ctx: ReceiptContext,
  log: (m: string) => void = () => {},
): Promise<DisclosureReceipt> {
  const tag = contextTag(ctx);
  const amount = BigInt(note.amount);
  log(`Constructing witness for note ${note.commitment.slice(0, 10)}…`);
  log("Proving (Groth16 / BN254)…");
  const { proof, publicSignals } = await groth16.fullProve(
    {
      commitment: BigInt(note.commitment),
      amount,
      auditorTag: tag,
      sk: BigInt(note.sk),
      blinding: BigInt(note.blinding),
    },
    WASM,
    ZKEY,
  );
  return {
    version: 1,
    network: NETWORK,
    pool: POOL_ID ?? "",
    context: ctx,
    note: { commitment: note.commitment, amount: amount.toString() },
    viewKey: deriveViewKey(master).toString(),
    contextTag: tag.toString(),
    proof,
    publicSignals,
    issuedAt: new Date().toISOString(),
  };
}

/** Auditor side: three independent checks — proof, context binding, on-chain freshness. */
export async function verifyReceipt(
  r: DisclosureReceipt,
  onChainLeaves?: Set<string>,
): Promise<ReceiptChecks> {
  let proofValid = false;
  try {
    const vkey = await (await fetch(VKEY)).json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proofValid = await groth16.verify(vkey, r.publicSignals, r.proof as any);
  } catch {
    proofValid = false;
  }
  const contextValid = contextMatches(r.publicSignals, r.context, r.note.commitment, r.note.amount);
  const rootFresh = onChainLeaves ? onChainLeaves.has(r.note.commitment) : true;
  return { proofValid, contextValid, rootFresh };
}
