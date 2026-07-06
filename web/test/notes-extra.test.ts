// Extra coverage for lib/notes.ts: the receiving-key derivation, the
// server-driven wallet loader (SSO/custodial path), wallet-namespace scoping,
// and Merkle-tree reconstruction from persisted leaves. Complements
// test/notes.test.ts, which already covers the core note/tree primitives.
import "./helpers";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ready, poseidon } from "../lib/poseidon";
import {
  RECV_INDEX,
  deriveReceiveKey,
  deriveSpendKey,
  loadWalletForMaster,
  setWalletNamespace,
  buildTree,
  saveWallet,
  MerkleTree,
  type WalletState,
} from "../lib/notes";
import { resetStorage } from "./helpers";

before(async () => {
  await ready();
});

test("deriveReceiveKey uses the dedicated RECV_INDEX and is deterministic", () => {
  const master = 0xBEEFn;
  const { sk, pk } = deriveReceiveKey(master);
  assert.equal(sk, deriveSpendKey(master, RECV_INDEX));
  assert.equal(pk, poseidon([sk]));
  // deterministic across calls
  const again = deriveReceiveKey(master);
  assert.equal(again.sk, sk);
  assert.equal(again.pk, pk);
});

test("deriveReceiveKey differs from ordinary note-derivation indices", () => {
  const master = 0xBEEFn;
  const { sk: recvSk } = deriveReceiveKey(master);
  const noteSk1 = deriveSpendKey(master, 1);
  const noteSk2 = deriveSpendKey(master, 2);
  assert.notEqual(recvSk, noteSk1);
  assert.notEqual(recvSk, noteSk2);
});

test("loadWalletForMaster: creates a fresh wallet bound to the given master", () => {
  resetStorage();
  setWalletNamespace("user-a");
  const w = loadWalletForMaster("12345");
  assert.equal(w.master, "12345");
  assert.equal(w.nextIndex, 1);
  assert.deepEqual(w.notes, []);
  assert.deepEqual(w.leaves, []);
});

test("loadWalletForMaster: reloads the same wallet when the master matches", () => {
  resetStorage();
  setWalletNamespace("user-b");
  const w = loadWalletForMaster("999");
  w.leaves.push("111");
  w.nextIndex = 5;
  saveWallet(w);

  const reloaded = loadWalletForMaster("999");
  assert.equal(reloaded.master, "999");
  assert.equal(reloaded.nextIndex, 5);
  assert.deepEqual(reloaded.leaves, ["111"]);
});

test("loadWalletForMaster: rebuilds fresh if the stored wallet belongs to a different master", () => {
  resetStorage();
  setWalletNamespace("user-c");
  const first = loadWalletForMaster("aaa");
  first.leaves.push("222");
  saveWallet(first);

  // A different master under the same namespace must NOT reuse stale state.
  const second = loadWalletForMaster("bbb");
  assert.equal(second.master, "bbb");
  assert.deepEqual(second.leaves, []);
});

test("setWalletNamespace isolates wallets per identity under the same storage backend", () => {
  resetStorage();
  setWalletNamespace("alice");
  const aliceWallet = loadWalletForMaster("alice-master");
  aliceWallet.leaves.push("1");
  saveWallet(aliceWallet);

  setWalletNamespace("bob");
  const bobWallet = loadWalletForMaster("bob-master");
  assert.deepEqual(bobWallet.leaves, []); // bob's namespace starts clean

  setWalletNamespace("alice");
  const aliceReloaded = loadWalletForMaster("alice-master");
  assert.deepEqual(aliceReloaded.leaves, ["1"]); // alice's state persisted independently
});

test("buildTree reconstructs the same root as inserting leaves directly", () => {
  const w: WalletState = {
    master: "1",
    nextIndex: 1,
    notes: [],
    leaves: ["11", "22", "33"],
  };
  const rebuilt = buildTree(w);

  // Insert the same leaves into a fresh tree and compare roots.
  const direct = new MerkleTree();
  [11n, 22n, 33n].forEach((l) => direct.insert(l));

  assert.equal(rebuilt.root, direct.root);
  assert.equal(rebuilt.leaves.length, 3);
});

test("buildTree on an empty leaf list yields the canonical empty root", () => {
  const w: WalletState = { master: "1", nextIndex: 1, notes: [], leaves: [] };
  const empty = new MerkleTree();
  assert.equal(buildTree(w).root, empty.root);
});
