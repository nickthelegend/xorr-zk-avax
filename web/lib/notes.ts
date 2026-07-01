// Shielded note model + UTXO account + client-side Merkle tree + persistence.
//
// ## Moonlight-style UTXO accounts (deterministic derivation)
// A single *master key* controls a whole "constellation" of unlinkable notes.
// Every note gets its own freshly-derived spend key, so notes can't be linked
// on-chain by a shared key, yet the entire wallet is recoverable from the
// master alone (à la Moonlight / Nethermind's keypair circuit):
//
//   spendKey(i) = Poseidon(master, i)        // i >= 1, one per note
//   viewKey     = Poseidon(master, 0)         // disclose to auditors (read-only)
//   pk          = Poseidon(spendKey)          // == keypair.circom: publicKey = Poseidon(sk)
//   commitment  = Poseidon(amount, pk, blinding)
//   nullifier   = Poseidon(commitment, spendKey)
//
// The spend keys and blindings are secret; only commitments and (on spend)
// unlinkable nullifiers ever touch the chain.
import { poseidon, toBytes32, randomField, ready } from "./poseidon";
import { TREE_DEPTH, POOL_ID } from "./config";

export interface Note {
  amount: string; // base units, as decimal string (bigint-safe)
  keyIndex: number; // derivation index; sk = Poseidon(master, keyIndex)
  sk: string; // cached derived spend key (recoverable from master+keyIndex)
  blinding: string;
  commitment: string; // decimal field element
  leafIndex?: number; // position once inserted
  spent?: boolean;
}

export async function initCrypto() {
  await ready();
}

/** Deterministic per-note spend key from the account master key. */
export function deriveSpendKey(master: bigint, index: number): bigint {
  return poseidon([master, BigInt(index)]);
}

/** Read-only viewing key for compliance/selective disclosure. */
export function deriveViewKey(master: bigint): bigint {
  return poseidon([master, 0n]);
}

// Dedicated derivation index for the account's *receiving* key, so incoming
// payments land on a stable, shareable address key (deposits use 1,2,3…).
export const RECV_INDEX = 1_000_000;

/** The account's receiving keypair (others send notes to `pk`). */
export function deriveReceiveKey(master: bigint): { sk: bigint; pk: bigint } {
  const sk = deriveSpendKey(master, RECV_INDEX);
  return { sk, pk: poseidon([sk]) };
}

export function deriveCommitment(amount: bigint, sk: bigint, blinding: bigint): bigint {
  const pk = poseidon([sk]);
  return poseidon([amount, pk, blinding]);
}

export function deriveNullifier(commitment: bigint, sk: bigint): bigint {
  return poseidon([commitment, sk]);
}

export function publicKey(sk: bigint): bigint {
  return poseidon([sk]);
}

/** Create a fresh note for `amount` under derivation `index` of `master`. */
export function createNote(master: bigint, index: number, amount: bigint): Note {
  const sk = deriveSpendKey(master, index);
  const blinding = randomField();
  const commitment = deriveCommitment(amount, sk, blinding);
  return {
    amount: amount.toString(),
    keyIndex: index,
    sk: sk.toString(),
    blinding: blinding.toString(),
    commitment: commitment.toString(),
  };
}

export function commitmentBytes(note: Note): Uint8Array {
  return toBytes32(BigInt(note.commitment));
}

export function nullifierBytes(note: Note): Uint8Array {
  return toBytes32(deriveNullifier(BigInt(note.commitment), BigInt(note.sk)));
}

// --- Incremental Poseidon Merkle tree (mirror of the on-chain tree) ---------

export class MerkleTree {
  depth: number;
  zeros: bigint[] = [];
  // filledSubtrees[i] = left-sibling cache used for the next insertion at level i
  filledSubtrees: bigint[] = [];
  leaves: bigint[] = [];
  root: bigint;

  constructor(depth = TREE_DEPTH) {
    this.depth = depth;
    let cur = 0n;
    for (let i = 0; i < depth; i++) {
      this.zeros[i] = cur;
      this.filledSubtrees[i] = cur;
      cur = poseidon([cur, cur]);
    }
    this.root = cur;
  }

  /** Append a leaf, returning {index, pathElements, pathIndices, oldRoot, newRoot}. */
  insert(leaf: bigint) {
    const index = this.leaves.length;
    const oldRoot = this.root;
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let cur = leaf;
    let idx = index;
    for (let i = 0; i < this.depth; i++) {
      const isRight = idx & 1;
      pathIndices.push(isRight);
      if (isRight === 0) {
        pathElements.push(this.zeros[i]);
        this.filledSubtrees[i] = cur;
        cur = poseidon([cur, this.zeros[i]]);
      } else {
        pathElements.push(this.filledSubtrees[i]);
        cur = poseidon([this.filledSubtrees[i], cur]);
      }
      idx >>= 1;
    }
    this.leaves.push(leaf);
    this.root = cur;
    return { index, pathElements, pathIndices, oldRoot, newRoot: cur };
  }

  /** Authentication path for an already-inserted leaf (for membership proofs). */
  proof(index: number) {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    // Recompute layer-by-layer from current leaves.
    let layer = [...this.leaves];
    let idx = index;
    for (let i = 0; i < this.depth; i++) {
      const isRight = idx & 1;
      const sibIdx = isRight ? idx - 1 : idx + 1;
      pathIndices.push(isRight);
      pathElements.push(sibIdx < layer.length ? layer[sibIdx] : this.zeros[i]);
      // build next layer
      const next: bigint[] = [];
      for (let j = 0; j < layer.length; j += 2) {
        const l = layer[j];
        const r = j + 1 < layer.length ? layer[j + 1] : this.zeros[i];
        next.push(poseidon([l, r]));
      }
      layer = next;
      idx >>= 1;
    }
    return { pathElements, pathIndices };
  }

  rootBytes(): Uint8Array {
    return toBytes32(this.root);
  }
}

// --- Local wallet persistence ----------------------------------------------

// Scope wallet state to the active pool: switching pools (env change) starts a
// fresh wallet so the local note/tree mirror can't desync from a different
// pool's on-chain state.
const BASE_STORAGE_KEY = `shieldedbridge.wallet.v2.${(POOL_ID || "none").slice(0, 12)}`;

// Active storage key. For Freighter (single local wallet) this is the base key.
// For SSO/custodial sessions it's namespaced per identity so multiple accounts
// can share a browser without their note/tree mirrors colliding.
let _activeKey = BASE_STORAGE_KEY;

/** Scope wallet persistence to an identity (e.g. a stable routeKey), or reset to the base key. */
export function setWalletNamespace(ns?: string | null) {
  _activeKey = ns ? `${BASE_STORAGE_KEY}.${ns.slice(0, 24)}` : BASE_STORAGE_KEY;
}

export interface WalletState {
  master: string; // account master key; all spend/view keys derive from this
  nextIndex: number; // next note derivation index (>= 1)
  notes: Note[];
  // Ordered list of every commitment ever inserted (this single-user demo
  // mirrors the on-chain append-only tree; a multi-user deployment rebuilds
  // this from contract events via an indexer).
  leaves: string[];
}

export function loadWallet(): WalletState {
  const raw = localStorage.getItem(_activeKey);
  if (raw) {
    const w = JSON.parse(raw);
    if (!w.leaves) w.leaves = [];
    // Migrate the older single-spendKey format to the UTXO account model.
    if (w.spendKey && !w.master) {
      w.master = w.spendKey;
      w.nextIndex = 1;
      delete w.spendKey;
    }
    if (typeof w.nextIndex !== "number") w.nextIndex = 1;
    return w;
  }
  const fresh: WalletState = {
    master: randomField().toString(),
    nextIndex: 1,
    notes: [],
    leaves: [],
  };
  localStorage.setItem(_activeKey, JSON.stringify(fresh));
  return fresh;
}

/**
 * Load (or initialize) the wallet for the active namespace bound to a SPECIFIC
 * master — used by SSO/custodial sessions where the master is derived server-
 * side, not randomly generated. If the stored wallet was built from a different
 * master (stale namespace), it's rebuilt fresh so notes/tree stay consistent.
 */
export function loadWalletForMaster(master: string): WalletState {
  const raw = localStorage.getItem(_activeKey);
  if (raw) {
    const w = JSON.parse(raw);
    if (!w.leaves) w.leaves = [];
    if (typeof w.nextIndex !== "number") w.nextIndex = 1;
    if (w.master === master) return w;
  }
  const fresh: WalletState = { master, nextIndex: 1, notes: [], leaves: [] };
  localStorage.setItem(_activeKey, JSON.stringify(fresh));
  return fresh;
}

/** Allocate the next derivation index for a new note. */
export function nextKeyIndex(w: WalletState): number {
  const i = w.nextIndex;
  w.nextIndex = i + 1;
  return i;
}

/** Rebuild the Merkle tree mirror from the recorded leaves. */
export function buildTree(w: WalletState): MerkleTree {
  const t = new MerkleTree();
  for (const l of w.leaves) t.insert(BigInt(l));
  return t;
}

export function saveWallet(w: WalletState) {
  localStorage.setItem(_activeKey, JSON.stringify(w));
}

/** Wipe this pool's local wallet state (notes + tree mirror) and start fresh.
 *  Use if the local mirror desyncs from the chain (e.g. a missed indexer post). */
export function resetWallet(): WalletState {
  localStorage.removeItem(_activeKey);
  return loadWallet();
}

export function shieldedBalance(w: WalletState): bigint {
  return w.notes
    .filter((n) => !n.spent)
    .reduce((acc, n) => acc + BigInt(n.amount), 0n);
}
