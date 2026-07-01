// High-level shielded operations: build the witness, prove, and invoke the
// PrivacyPool / Bridge contracts. Each op keeps the local note set + Merkle
// mirror in sync with the chain.
//
// UTXO accounts: every new note is created under a fresh derivation index of
// the wallet master key (`createNote`/`nextKeyIndex`), so notes are unlinkable
// on-chain yet fully recoverable from the master. Each spent input is signed
// with its own derived key (`note.sk`).
import { Address } from "@stellar/stellar-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { POOL_ID, BRIDGE_ID, BRIDGE_SINK, deliveryEnabled } from "./config";
import { invoke, simulateCall, addr, i128, u64, bytesN32 } from "./stellar";
import { prove, proofToScVal } from "./prover";
import {
  WalletState,
  Note,
  buildTree,
  createNote,
  deriveNullifier,
  deriveReceiveKey,
  nextKeyIndex,
  publicKey,
  saveWallet,
  RECV_INDEX,
} from "./notes";
import { poseidon, toBytes32, randomField } from "./poseidon";
import { fmt } from "./format";
import {
  fetchLeaves, postLeaves, parseAddress, encryptTo, postNote, fetchNotes,
  decryptBlob, encKeyPair, encPubB64, routeKey,
} from "./delivery";
import * as offrampApi from "./offramp";

export type Logger = (msg: string) => void;

/** Pull the global commitment index into the wallet so the local tree mirror
 *  matches the on-chain tree (incl. notes inserted by other users). */
export async function sync(w: WalletState): Promise<void> {
  if (!deliveryEnabled()) return;
  const leaves = await fetchLeaves(POOL_ID);
  if (leaves.length >= w.leaves.length) {
    w.leaves = leaves.map((l) => l.commitment);
    saveWallet(w);
  }
}

async function publishLeaves(startIndex: number, commitments: bigint[]): Promise<void> {
  if (!deliveryEnabled()) return;
  await postLeaves(POOL_ID, commitments.map((c, i) => ({ index: startIndex + i, commitment: c.toString() })));
}

/** Current on-chain Merkle root as 32 bytes. */
export async function onChainRoot(): Promise<Uint8Array> {
  const r = await simulateCall(POOL_ID, "current_root");
  return r instanceof Uint8Array ? r : new Uint8Array(r);
}

export async function totalShielded(): Promise<bigint> {
  const t = await simulateCall(POOL_ID, "total_shielded");
  return BigInt(t ?? 0);
}

// Recipient binding for withdrawals. Must equal the contract's on-chain
// derivation `fr_from_tag(keccak256(recipient.to_xdr(env)))`:
//   * recipient.to_xdr(env) == Address.toScVal().toXDR() (the address ScVal XDR)
//   * keccak256, then mask the top byte to 0x1f so the value is < r.
// The withdraw circuit binds this as a public input (quadratic constraint), so
// the payout target cannot be substituted after proving.
function recipientField(address: string): bigint {
  const xdr = Address.fromString(address).toScVal().toXDR();
  const tag = keccak_256(new Uint8Array(xdr));
  tag[0] &= 0x1f;
  let v = 0n;
  for (const b of tag) v = (v << 8n) | BigInt(b);
  return v;
}

/** Shield public tokens -> a new private note. */
export async function deposit(
  pk: string,
  w: WalletState,
  amount: bigint,
  log: Logger = () => {},
): Promise<void> {
  await sync(w);
  const note = createNote(BigInt(w.master), nextKeyIndex(w), amount);
  const commitment = BigInt(note.commitment);

  const tree = buildTree(w);
  const ins = tree.insert(commitment);
  log(`Built witness (leaf #${ins.index}). Generating proof…`);

  const { proof } = await prove("deposit", {
    oldRoot: ins.oldRoot,
    newRoot: ins.newRoot,
    commitment,
    amount,
    sk: BigInt(note.sk),
    blinding: BigInt(note.blinding),
    pathElements: ins.pathElements,
    pathIndices: ins.pathIndices,
  });

  log("Submitting deposit…");
  await invoke(pk, POOL_ID, "deposit", [
    addr(pk),
    i128(amount),
    bytesN32(toBytes32(commitment)),
    bytesN32(toBytes32(ins.oldRoot)),
    bytesN32(toBytes32(ins.newRoot)),
    proofToScVal(proof),
  ]);

  note.leafIndex = ins.index;
  w.leaves.push(commitment.toString());
  w.notes.push(note);
  saveWallet(w);
  await publishLeaves(ins.index, [commitment]);
  log("Deposit confirmed. Note shielded.");
}

/** Private transfer: spend two owned notes -> two new notes (split/merge).
 *  `recipientPk` (a shielded public key) sends output A to someone else;
 *  null re-shields both outputs to fresh keys of this account. */
export async function transfer(
  pk: string,
  w: WalletState,
  inA: Note,
  inB: Note,
  outAmountA: bigint,
  recipientPk: bigint | null,
  log: Logger = () => {},
): Promise<void> {
  await sync(w);
  const master = BigInt(w.master);
  const skA = BigInt(inA.sk);
  const skB = BigInt(inB.sk);
  const inAmtA = BigInt(inA.amount);
  const inAmtB = BigInt(inB.amount);
  const total = inAmtA + inAmtB;
  if (outAmountA > total) throw new Error("output exceeds inputs");
  const outAmountB = total - outAmountA;

  const tree = buildTree(w);
  const memA = tree.proof(inA.leafIndex!);
  const memB = tree.proof(inB.leafIndex!);
  const oldRoot = tree.root;

  // Output A: external recipient (kept by them) or a fresh self note.
  let outNoteA: Note | null = null;
  let pkOutA: bigint, blindA: bigint, outCmtA: bigint;
  if (recipientPk !== null) {
    pkOutA = recipientPk;
    blindA = randomField();
    outCmtA = poseidon([outAmountA, pkOutA, blindA]);
  } else {
    outNoteA = createNote(master, nextKeyIndex(w), outAmountA);
    pkOutA = publicKey(BigInt(outNoteA.sk));
    blindA = BigInt(outNoteA.blinding);
    outCmtA = BigInt(outNoteA.commitment);
  }

  // Output B: change, always re-shielded to a fresh self note.
  const outNoteB = createNote(master, nextKeyIndex(w), outAmountB);
  const pkOutB = publicKey(BigInt(outNoteB.sk));
  const blindB = BigInt(outNoteB.blinding);
  const outCmtB = BigInt(outNoteB.commitment);

  const insA = tree.insert(outCmtA);
  const insB = tree.insert(outCmtB);
  const nfA = deriveNullifier(BigInt(inA.commitment), skA);
  const nfB = deriveNullifier(BigInt(inB.commitment), skB);

  log("Generating transfer proof…");
  const { proof } = await prove("transfer", {
    oldRoot,
    newRoot: insB.newRoot,
    nullifierA: nfA,
    nullifierB: nfB,
    outCommitmentA: outCmtA,
    outCommitmentB: outCmtB,
    inAmountA: inAmtA, inSkA: skA, inBlindingA: BigInt(inA.blinding),
    inPathElementsA: memA.pathElements, inPathIndicesA: memA.pathIndices,
    inAmountB: inAmtB, inSkB: skB, inBlindingB: BigInt(inB.blinding),
    inPathElementsB: memB.pathElements, inPathIndicesB: memB.pathIndices,
    outAmountA, outPkA: pkOutA, outBlindingA: blindA,
    outInsPathElementsA: insA.pathElements, outInsPathIndicesA: insA.pathIndices,
    outAmountB, outPkB: pkOutB, outBlindingB: blindB,
    outInsPathElementsB: insB.pathElements, outInsPathIndicesB: insB.pathIndices,
  });

  log("Submitting transfer…");
  await invoke(pk, POOL_ID, "transfer", [
    bytesN32(toBytes32(nfA)),
    bytesN32(toBytes32(nfB)),
    bytesN32(toBytes32(outCmtA)),
    bytesN32(toBytes32(outCmtB)),
    bytesN32(toBytes32(oldRoot)),
    bytesN32(toBytes32(insB.newRoot)),
    proofToScVal(proof),
  ]);

  inA.spent = true;
  inB.spent = true;
  w.leaves.push(outCmtA.toString(), outCmtB.toString());
  if (outNoteA) { outNoteA.leafIndex = insA.index; w.notes.push(outNoteA); }
  outNoteB.leafIndex = insB.index;
  w.notes.push(outNoteB);
  saveWallet(w);
  await publishLeaves(insA.index, [outCmtA, outCmtB]);
  log("Transfer confirmed.");
}

/** Unshield: spend one note, pay `amount` to `recipient`, re-shield the change. */
export async function withdraw(
  pk: string,
  w: WalletState,
  note: Note,
  recipient: string,
  amount: bigint,
  log: Logger = () => {},
): Promise<void> {
  await sync(w);
  const master = BigInt(w.master);
  const sk = BigInt(note.sk);
  const inAmt = BigInt(note.amount);
  if (amount > inAmt) throw new Error("amount exceeds note value");
  const changeAmt = inAmt - amount;

  const tree = buildTree(w);
  const mem = tree.proof(note.leafIndex!);
  const oldRoot = tree.root;

  const changeNote = createNote(master, nextKeyIndex(w), changeAmt);
  const changeCmt = BigInt(changeNote.commitment);
  const ins = tree.insert(changeCmt);
  const nf = deriveNullifier(BigInt(note.commitment), sk);

  log("Generating withdraw proof…");
  const { proof } = await prove("withdraw", {
    oldRoot,
    newRoot: ins.newRoot,
    nullifier: nf,
    changeCommitment: changeCmt,
    amount,
    recipientField: recipientField(recipient),
    inAmount: inAmt, inSk: sk, inBlinding: BigInt(note.blinding),
    inPathElements: mem.pathElements, inPathIndices: mem.pathIndices,
    changeAmount: changeAmt,
    changePk: publicKey(BigInt(changeNote.sk)),
    changeBlinding: BigInt(changeNote.blinding),
    changeInsPathElements: ins.pathElements, changeInsPathIndices: ins.pathIndices,
  });

  log("Submitting withdraw…");
  await invoke(pk, POOL_ID, "withdraw", [
    addr(recipient),
    i128(amount),
    bytesN32(toBytes32(nf)),
    bytesN32(toBytes32(changeCmt)),
    bytesN32(toBytes32(oldRoot)),
    bytesN32(toBytes32(ins.newRoot)),
    proofToScVal(proof),
  ]);

  note.spent = true;
  w.leaves.push(changeCmt.toString());
  if (changeAmt > 0n) {
    changeNote.leafIndex = ins.index;
    w.notes.push(changeNote);
  }
  saveWallet(w);
  await publishLeaves(ins.index, [changeCmt]);
  log(`Withdrew ${amount} to ${recipient.slice(0, 6)}…`);
}

/**
 * Private (ZK) swap: spend a shielded note worth `amount` (proven with the same
 * Withdraw statement), route it through the on-chain AMM the pool is wired to,
 * and deliver the swapped output token to `recipient`. The USDC change is
 * re-shielded. No public account links the spender to the trade.
 */
export async function privateSwap(
  pk: string,
  w: WalletState,
  note: Note,
  recipient: string,
  amount: bigint,
  minOut: bigint,
  log: Logger = () => {},
): Promise<{ hash: string; amountOut: bigint }> {
  await sync(w);
  const master = BigInt(w.master);
  const sk = BigInt(note.sk);
  const inAmt = BigInt(note.amount);
  if (amount > inAmt) throw new Error("amount exceeds note value");
  const changeAmt = inAmt - amount;

  const tree = buildTree(w);
  const mem = tree.proof(note.leafIndex!);
  const oldRoot = tree.root;

  const changeNote = createNote(master, nextKeyIndex(w), changeAmt);
  const changeCmt = BigInt(changeNote.commitment);
  const ins = tree.insert(changeCmt);
  const nf = deriveNullifier(BigInt(note.commitment), sk);

  log("Generating ZK swap proof (withdraw circuit)…");
  const { proof } = await prove("withdraw", {
    oldRoot,
    newRoot: ins.newRoot,
    nullifier: nf,
    changeCommitment: changeCmt,
    amount,
    recipientField: recipientField(recipient),
    inAmount: inAmt, inSk: sk, inBlinding: BigInt(note.blinding),
    inPathElements: mem.pathElements, inPathIndices: mem.pathIndices,
    changeAmount: changeAmt,
    changePk: publicKey(BigInt(changeNote.sk)),
    changeBlinding: BigInt(changeNote.blinding),
    changeInsPathElements: ins.pathElements, changeInsPathIndices: ins.pathIndices,
  });

  log("Submitting private swap…");
  const { hash, returnValue } = await invoke(pk, POOL_ID, "private_swap", [
    addr(recipient),
    i128(amount),
    bytesN32(toBytes32(nf)),
    bytesN32(toBytes32(changeCmt)),
    bytesN32(toBytes32(oldRoot)),
    bytesN32(toBytes32(ins.newRoot)),
    i128(minOut),
    proofToScVal(proof),
  ]);

  note.spent = true;
  w.leaves.push(changeCmt.toString());
  if (changeAmt > 0n) {
    changeNote.leafIndex = ins.index;
    w.notes.push(changeNote);
  }
  saveWallet(w);
  await publishLeaves(ins.index, [changeCmt]);
  const amountOut = returnValue != null ? BigInt(returnValue) : 0n;
  log(`Private swap done → ${amountOut} to ${recipient.slice(0, 6)}…`);
  return { hash, amountOut };
}

/** Bridge ETH-locked value into a shielded Stellar note (relayer flow). */
export async function bridgeIn(
  relayerPk: string,
  w: WalletState,
  ethNonce: bigint,
  amount: bigint,
  log: Logger = () => {},
): Promise<{ hash: string; commitment: string; nullifier: string }> {
  await sync(w);
  const note = createNote(BigInt(w.master), nextKeyIndex(w), amount);
  const commitment = BigInt(note.commitment);
  const tree = buildTree(w);
  const ins = tree.insert(commitment);

  log("Generating bridge proof (deposit circuit)…");
  const { proof } = await prove("deposit", {
    oldRoot: ins.oldRoot, newRoot: ins.newRoot, commitment, amount,
    sk: BigInt(note.sk), blinding: BigInt(note.blinding),
    pathElements: ins.pathElements, pathIndices: ins.pathIndices,
  });

  log("Calling bridge_in…");
  const { hash } = await invoke(relayerPk, BRIDGE_ID, "bridge_in", [
    u64(ethNonce),
    i128(amount),
    bytesN32(toBytes32(commitment)),
    bytesN32(toBytes32(ins.oldRoot)),
    bytesN32(toBytes32(ins.newRoot)),
    proofToScVal(proof),
  ]);

  note.leafIndex = ins.index;
  w.leaves.push(commitment.toString());
  w.notes.push(note);
  saveWallet(w);
  await publishLeaves(ins.index, [commitment]);
  log("Bridged in. Note shielded on Stellar.");
  const nullifier = deriveNullifier(commitment, BigInt(note.sk)).toString();
  return { hash, commitment: commitment.toString(), nullifier };
}

// --- Relayer-based bridge (real cross-chain) -------------------------------
// The frontend prepares the note + proof client-side (only it has the secrets),
// locks USDC on Ethereum, then hands this to the relayer which submits bridge_in.
const _hx = (u: Uint8Array) => "0x" + Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export interface BridgePrep {
  note: Note;
  commitment: string; // 0x… 32-byte
  oldRoot: string;
  newRoot: string;
  proof: { a: string; b: string; c: string };
  leafIndex: number;
  amount: string;
}

/** Generate the shielded note + Groth16 proof for a bridge-in (no submission). */
export async function prepareBridgeIn(w: WalletState, amount: bigint, log: Logger = () => {}): Promise<BridgePrep> {
  await sync(w);
  const note = createNote(BigInt(w.master), nextKeyIndex(w), amount);
  const commitment = BigInt(note.commitment);
  const tree = buildTree(w);
  const ins = tree.insert(commitment);
  log("Generating bridge proof (Groth16 / BN254)…");
  const { proof } = await prove("deposit", {
    oldRoot: ins.oldRoot, newRoot: ins.newRoot, commitment, amount,
    sk: BigInt(note.sk), blinding: BigInt(note.blinding),
    pathElements: ins.pathElements, pathIndices: ins.pathIndices,
  });
  return {
    note, leafIndex: ins.index, amount: amount.toString(),
    commitment: _hx(toBytes32(commitment)),
    oldRoot: _hx(toBytes32(ins.oldRoot)),
    newRoot: _hx(toBytes32(ins.newRoot)),
    proof: { a: _hx(proof.a), b: _hx(proof.b), c: _hx(proof.c) },
  };
}

/** Record the bridged note locally once the relayer has minted it on Stellar. */
export function recordBridgedNote(w: WalletState, prep: BridgePrep, log: Logger = () => {}) {
  prep.note.leafIndex = prep.leafIndex;
  w.leaves.push(BigInt(prep.note.commitment).toString());
  w.notes.push(prep.note);
  saveWallet(w);
  log("Bridged in. Note shielded on Stellar.");
}

// --- Reverse bridge (Stellar → Ethereum) ----------------------------------
// Bridging OUT spends (burns) a shielded note with a real Withdraw proof that
// unshields the value to the bridge sink (BRIDGE_SINK, the relayer's Stellar
// account) — value-conserving — and yields a single-use `nullifier`. The
// relayer submits that withdraw (it is the bound recipient), then calls the
// escrow's `release(ethRecipient, amount, nullifier)` on Ethereum. The nullifier
// is single-use on BOTH chains, so a burn can be released at most once.
export interface BridgeOutPrep {
  nullifier: string; // 0x… 32-byte (bound on both chains)
  changeCommitment: string;
  oldRoot: string;
  newRoot: string;
  proof: { a: string; b: string; c: string };
  amount: string;
  recipient: string; // BRIDGE_SINK (Stellar), bound in the proof
  changeNote: Note;
  changeIndex: number;
}

/** Generate the Withdraw proof that burns `note`'s `amount` to the bridge sink
 *  (no submission — the relayer submits it as the bound recipient). */
export async function prepareBridgeOut(
  w: WalletState,
  note: Note,
  amount: bigint,
  log: Logger = () => {},
): Promise<BridgeOutPrep> {
  await sync(w);
  const master = BigInt(w.master);
  const sk = BigInt(note.sk);
  const inAmt = BigInt(note.amount);
  if (amount > inAmt) throw new Error("amount exceeds note value");
  const changeAmt = inAmt - amount;

  const tree = buildTree(w);
  const mem = tree.proof(note.leafIndex!);
  const oldRoot = tree.root;
  const changeNote = createNote(master, nextKeyIndex(w), changeAmt);
  const changeCmt = BigInt(changeNote.commitment);
  const ins = tree.insert(changeCmt);
  const nf = deriveNullifier(BigInt(note.commitment), sk);

  log("Generating bridge-out proof (withdraw circuit)…");
  const { proof } = await prove("withdraw", {
    oldRoot, newRoot: ins.newRoot, nullifier: nf, changeCommitment: changeCmt, amount,
    recipientField: recipientField(BRIDGE_SINK),
    inAmount: inAmt, inSk: sk, inBlinding: BigInt(note.blinding),
    inPathElements: mem.pathElements, inPathIndices: mem.pathIndices,
    changeAmount: changeAmt, changePk: publicKey(BigInt(changeNote.sk)),
    changeBlinding: BigInt(changeNote.blinding),
    changeInsPathElements: ins.pathElements, changeInsPathIndices: ins.pathIndices,
  });

  return {
    nullifier: _hx(toBytes32(nf)),
    changeCommitment: _hx(toBytes32(changeCmt)),
    oldRoot: _hx(toBytes32(oldRoot)),
    newRoot: _hx(toBytes32(ins.newRoot)),
    proof: { a: _hx(proof.a), b: _hx(proof.b), c: _hx(proof.c) },
    amount: amount.toString(), recipient: BRIDGE_SINK,
    changeNote, changeIndex: ins.index,
  };
}

/** Record a bridge-out locally once the relayer has burned + released it. */
export function recordBridgeOut(w: WalletState, note: Note, prep: BridgeOutPrep) {
  note.spent = true;
  w.leaves.push(BigInt(prep.changeNote.commitment).toString());
  if (BigInt(prep.changeNote.amount) > 0n) {
    prep.changeNote.leafIndex = prep.changeIndex;
    w.notes.push(prep.changeNote);
  }
  saveWallet(w);
}

/** Cross-user private payment: send `amount` to a recipient's shielded address.
 *  Spends two of your notes, creates the recipient's note + your change, and
 *  delivers the encrypted opening so the recipient can discover & spend it. */
export async function payTo(
  pk: string,
  w: WalletState,
  recipientAddress: string,
  amount: bigint,
  log: Logger = () => {},
): Promise<void> {
  if (!deliveryEnabled()) throw new Error("delivery layer not configured (set NEXT_PUBLIC_DELIVERY_URL)");
  const { encPub } = parseAddress(recipientAddress);
  await sync(w);
  const master = BigInt(w.master);
  // Stealth: a fresh one-time note key the recipient receives (encrypted), so
  // the note is unlinkable on-chain to the recipient's reusable address.
  const oneTimeSk = randomField();
  const recipPk = publicKey(oneTimeSk);

  const unspent = w.notes.filter((n) => !n.spent && n.leafIndex != null)
    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
  if (unspent.length < 2) throw new Error("need ≥2 shielded notes to send — deposit again");
  const inA = unspent[0], inB = unspent[1];
  const sumIn = BigInt(inA.amount) + BigInt(inB.amount);
  if (amount > sumIn) throw new Error("amount exceeds your two largest notes — consolidate first");
  const changeAmt = sumIn - amount;

  const tree = buildTree(w);
  const memA = tree.proof(inA.leafIndex!), memB = tree.proof(inB.leafIndex!);
  const oldRoot = tree.root;

  const blindA = randomField();
  const outCmtA = poseidon([amount, recipPk, blindA]);            // recipient's note
  const changeNote = createNote(master, nextKeyIndex(w), changeAmt); // your change
  const outCmtB = BigInt(changeNote.commitment);
  const insA = tree.insert(outCmtA), insB = tree.insert(outCmtB);
  const nfA = deriveNullifier(BigInt(inA.commitment), BigInt(inA.sk));
  const nfB = deriveNullifier(BigInt(inB.commitment), BigInt(inB.sk));

  log("Generating private payment proof…");
  const { proof } = await prove("transfer", {
    oldRoot, newRoot: insB.newRoot, nullifierA: nfA, nullifierB: nfB,
    outCommitmentA: outCmtA, outCommitmentB: outCmtB,
    inAmountA: BigInt(inA.amount), inSkA: BigInt(inA.sk), inBlindingA: BigInt(inA.blinding),
    inPathElementsA: memA.pathElements, inPathIndicesA: memA.pathIndices,
    inAmountB: BigInt(inB.amount), inSkB: BigInt(inB.sk), inBlindingB: BigInt(inB.blinding),
    inPathElementsB: memB.pathElements, inPathIndicesB: memB.pathIndices,
    outAmountA: amount, outPkA: recipPk, outBlindingA: blindA,
    outInsPathElementsA: insA.pathElements, outInsPathIndicesA: insA.pathIndices,
    outAmountB: changeAmt, outPkB: publicKey(BigInt(changeNote.sk)), outBlindingB: BigInt(changeNote.blinding),
    outInsPathElementsB: insB.pathElements, outInsPathIndicesB: insB.pathIndices,
  });

  log("Submitting private payment…");
  await invoke(pk, POOL_ID, "transfer", [
    bytesN32(toBytes32(nfA)), bytesN32(toBytes32(nfB)),
    bytesN32(toBytes32(outCmtA)), bytesN32(toBytes32(outCmtB)),
    bytesN32(toBytes32(oldRoot)), bytesN32(toBytes32(insB.newRoot)),
    proofToScVal(proof),
  ]);

  inA.spent = true; inB.spent = true;
  w.leaves.push(outCmtA.toString(), outCmtB.toString());
  changeNote.leafIndex = insB.index; w.notes.push(changeNote);
  saveWallet(w);
  await publishLeaves(insA.index, [outCmtA, outCmtB]);

  // Deliver the encrypted opening (incl. the one-time spend key) so only the
  // recipient can find & spend the note.
  const blob = encryptTo(encPub, {
    amount: amount.toString(), blinding: blindA.toString(), sk: oneTimeSk.toString(),
  });
  await postNote(routeKey(encPub), { ...blob, commitment: outCmtA.toString() });
  log(`Sent ${amount} privately → ${recipientAddress.slice(0, 16)}…`);
}

/** Scan the delivery layer for incoming notes, decrypt, and add the spendable
 *  ones (those already present in the global tree) to the wallet. */
export async function scanIncoming(w: WalletState, log: Logger = () => {}): Promise<number> {
  if (!deliveryEnabled()) return 0;
  await sync(w);
  const master = BigInt(w.master);
  const encKp = encKeyPair(master);
  const blobs = await fetchNotes(routeKey(encPubB64(encKp)));
  const known = new Set(w.notes.map((n) => n.commitment));
  let added = 0;
  for (const blob of blobs) {
    const payload = decryptBlob<{ amount: string; blinding: string; sk: string }>(blob, encKp.secretKey);
    if (!payload) continue; // not addressed to us (won't decrypt)
    const amount = BigInt(payload.amount), blinding = BigInt(payload.blinding), sk = BigInt(payload.sk);
    const commitment = poseidon([amount, publicKey(sk), blinding]);
    if (known.has(commitment.toString())) continue;
    const leafIndex = w.leaves.indexOf(commitment.toString());
    if (leafIndex < 0) continue; // not yet visible in the global tree
    w.notes.push({
      amount: amount.toString(), keyIndex: RECV_INDEX, sk: sk.toString(),
      blinding: blinding.toString(), commitment: commitment.toString(), leafIndex,
    });
    known.add(commitment.toString());
    added++;
  }
  if (added) saveWallet(w);
  log(`Scanned incoming: ${added} new note(s).`);
  return added;
}

/** Off-ramp: unshield USDC on-chain to the operator, then settle a fiat payout
 *  through a sandbox rail (Midnight-style intent lifecycle + oracle attestation). */
export async function offramp(
  pk: string,
  w: WalletState,
  opts: { rail: string; currency: string; usdcAmount: bigint; payoutHandle: string; operator: string },
  log: Logger = () => {},
): Promise<{ intentId: string; status: string; railTxRef: string; quote: offrampApi.Quote }> {
  const human = fmt(opts.usdcAmount);
  log(`Requesting ${opts.rail} quote for ${human} USDC → ${opts.currency}…`);
  const { intentId, quote } = await offrampApi.initiate({
    rail: opts.rail, usdcAmount: human, currency: opts.currency, payoutHandle: opts.payoutHandle,
  });
  log(`Quote: ${quote.fiatOut} ${opts.currency} (rate ${quote.rate}, fee ${quote.fee})`);

  await sync(w);
  const note = w.notes
    .filter((n) => !n.spent && n.leafIndex != null && BigInt(n.amount) >= opts.usdcAmount)
    .sort((a, b) => Number(BigInt(a.amount) - BigInt(b.amount)))[0];
  if (!note) throw new Error("no single shielded note covers that amount — consolidate first");

  log(`Unshielding ${human} USDC on-chain to the off-ramp operator…`);
  await withdraw(pk, w, note, opts.operator, opts.usdcAmount, log);
  await offrampApi.lock(intentId);

  log("Settling fiat payout via rail (sandbox)…");
  const r = await offrampApi.settle(intentId);
  log(`Off-ramp ${r.status} · rail ref ${r.railTxRef}`);
  return { intentId, quote, status: r.status, railTxRef: r.railTxRef };
}
