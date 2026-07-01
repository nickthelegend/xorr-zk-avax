import "./helpers";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ready, poseidon } from "../lib/poseidon";
import {
  deriveSpendKey,
  deriveViewKey,
  deriveCommitment,
  deriveNullifier,
  publicKey,
  createNote,
  commitmentBytes,
  nullifierBytes,
  MerkleTree,
  shieldedBalance,
  loadWallet,
  saveWallet,
  resetWallet,
  nextKeyIndex,
  type WalletState,
} from "../lib/notes";
import { resetStorage } from "./helpers";

before(async () => {
  await ready();
});

// ── Note scheme (matches CLAUDE.md / the circuits) ──────────────────────────

test("pk = Poseidon(sk)", () => {
  assert.equal(publicKey(42n), poseidon([42n]));
});

test("commitment = Poseidon(amount, pk, blinding)", () => {
  const sk = 7n, amount = 100n, blinding = 9n;
  const pk = poseidon([sk]);
  assert.equal(deriveCommitment(amount, sk, blinding), poseidon([amount, pk, blinding]));
});

test("nullifier = Poseidon(commitment, sk)", () => {
  assert.equal(deriveNullifier(123n, 7n), poseidon([123n, 7n]));
});

// ── UTXO account model: deterministic, recoverable, unlinkable ──────────────

test("spend/view keys are deterministic and recoverable from the master alone", () => {
  const master = 0xC0FFEEn;
  assert.equal(deriveSpendKey(master, 1), deriveSpendKey(master, 1));
  assert.equal(deriveSpendKey(master, 1), poseidon([master, 1n]));
  assert.equal(deriveViewKey(master), poseidon([master, 0n]));
});

test("notes under different indices are unlinkable (distinct keys → distinct commitments)", () => {
  const master = 0xC0FFEEn;
  assert.notEqual(deriveSpendKey(master, 1), deriveSpendKey(master, 2));
  const a = deriveCommitment(50n, deriveSpendKey(master, 1), 1n);
  const b = deriveCommitment(50n, deriveSpendKey(master, 2), 1n);
  assert.notEqual(a, b);
});

test("createNote yields 32-byte commitment & nullifier encodings", () => {
  const note = createNote(123n, 1, 50n);
  assert.equal(note.amount, "50");
  assert.equal(note.keyIndex, 1);
  assert.equal(commitmentBytes(note).length, 32);
  assert.equal(nullifierBytes(note).length, 32);
  // nullifier is bound to this note's commitment + sk
  assert.equal(
    nullifierBytes(note)[31],
    Number(deriveNullifier(BigInt(note.commitment), BigInt(note.sk)) & 0xffn),
  );
});

// ── Incremental Merkle tree (mirror of the on-chain append-only tree) ───────

function recomputeRoot(leaf: bigint, pathElements: bigint[], pathIndices: number[]): bigint {
  let cur = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    cur = pathIndices[i]
      ? poseidon([pathElements[i], cur]) // cur is the right child
      : poseidon([cur, pathElements[i]]); // cur is the left child
  }
  return cur;
}

test("insert advances the root and reports old/new roots", () => {
  const t = new MerkleTree(4);
  const empty = t.root;
  const r = t.insert(11n);
  assert.equal(r.oldRoot, empty);
  assert.equal(r.newRoot, t.root);
  assert.notEqual(t.root, empty);
  assert.equal(r.index, 0);
});

test("membership proof recomputes the live root for every inserted leaf", () => {
  const t = new MerkleTree(4);
  const leaves = [11n, 22n, 33n, 44n, 55n];
  leaves.forEach((l) => t.insert(l));
  leaves.forEach((leaf, i) => {
    const { pathElements, pathIndices } = t.proof(i);
    assert.equal(recomputeRoot(leaf, pathElements, pathIndices), t.root, `leaf ${i}`);
  });
});

test("tree root is deterministic for identical leaf sequences", () => {
  const a = new MerkleTree(4);
  const b = new MerkleTree(4);
  [1n, 2n, 3n].forEach((x) => {
    a.insert(x);
    b.insert(x);
  });
  assert.equal(a.root, b.root);
});

// ── Wallet state ────────────────────────────────────────────────────────────

test("shieldedBalance sums only unspent notes", () => {
  const w: WalletState = {
    master: "1",
    nextIndex: 1,
    leaves: [],
    notes: [
      { amount: "100", keyIndex: 1, sk: "1", blinding: "1", commitment: "1" },
      { amount: "50", keyIndex: 2, sk: "1", blinding: "1", commitment: "2", spent: true },
      { amount: "25", keyIndex: 3, sk: "1", blinding: "1", commitment: "3" },
    ],
  };
  assert.equal(shieldedBalance(w), 125n);
});

test("wallet persistence: load creates, save/reload round-trips, reset clears", () => {
  resetStorage();
  const w = loadWallet();
  assert.ok(BigInt(w.master) > 0n);
  assert.equal(nextKeyIndex(w), 1);
  assert.equal(nextKeyIndex(w), 2); // advances
  w.notes.push(createNote(BigInt(w.master), 1, 10n));
  saveWallet(w);

  const reloaded = loadWallet();
  assert.equal(reloaded.master, w.master); // same account survives reload
  assert.equal(reloaded.notes.length, 1);

  const fresh = resetWallet();
  assert.equal(fresh.notes.length, 0);
  assert.notEqual(fresh.master, w.master); // brand new account
});
