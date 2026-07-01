// Prove the in-app deposit will now work: a fresh wallet that sync()s from the
// indexer must rebuild a tree whose root equals the pool's on-chain current_root.
// If so, its next deposit's oldRoot matches and the contract accepts it.
import { initCrypto, buildTree, type WalletState } from "../lib/notes";
import { fetchLeaves } from "../lib/delivery";
import { onChainRoot } from "../lib/pool";
import { POOL_ID } from "../lib/config";

const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");

await initCrypto();
const leaves = await fetchLeaves(POOL_ID);
const w: WalletState = { master: "1", nextIndex: 1, notes: [], leaves: leaves.map((l) => l.commitment) };
const tree = buildTree(w);
const localRoot = "0x" + tree.root.toString(16).padStart(64, "0");
const chainRoot = hex(await onChainRoot());

console.log("pool:", POOL_ID);
console.log("indexer leaves:", w.leaves.length);
console.log("local tree root :", localRoot);
console.log("on-chain root   :", chainRoot);
if (localRoot === chainRoot) {
  console.log("\n✅ IN-SYNC — a fresh wallet's tree matches the pool. In-app Shield will succeed (next leaf at index " + w.leaves.length + ").");
} else {
  console.log("\n❌ OUT OF SYNC — deposits would still fail with StaleRoot.");
  process.exit(1);
}
