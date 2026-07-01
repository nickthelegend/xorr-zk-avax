// Verify a real deposit into the (fresh) pool: a fresh wallet's empty-tree
// oldRoot must equal the pool's current_root, the proof must verify on-chain,
// and the note must be inserted (total_shielded grows, next_leaf advances).
//
// env: NEXT_PUBLIC_POOL_ID (the pool to deposit into), XORR_SECRET
import { groth16 } from "snarkjs";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { createNote, buildTree, initCrypto, type WalletState } from "../lib/notes";
import { toBytes32, randomField } from "../lib/poseidon";
import { bytesN32, i128, invoke, simulateCall, setSigner, addr } from "../lib/stellar";
import { NETWORK_PASSPHRASE, POOL_ID } from "../lib/config";

const XORR_SECRET = process.env.XORR_SECRET!;
const AMT = 100_000_000n; // 10 USDC @ 7 decimals

const FP = 32;
const fpBytes = (dec: string) => { let v = BigInt(dec); const o = new Uint8Array(FP); for (let i = FP - 1; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const g1 = (p: string[]) => cat(fpBytes(p[0]), fpBytes(p[1]));
const fp2 = (c: string[]) => cat(fpBytes(c[1]), fpBytes(c[0]));
const g2 = (p: string[][]) => cat(fp2(p[0]), fp2(p[1]));
const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");

async function main() {
  await initCrypto();
  const kp = Keypair.fromSecret(XORR_SECRET);
  setSigner(async (xdrStr: string) => { const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK_PASSPHRASE); tx.sign(kp); return tx.toXDR(); });
  console.log("pool:", POOL_ID, "\ndepositor:", kp.publicKey());

  // 1. fresh wallet → empty tree → insert the new note at index 0
  const wallet: WalletState = { master: randomField().toString(), nextIndex: 1, notes: [], leaves: [] };
  const note = createNote(BigInt(wallet.master), 1, AMT);
  const commitment = BigInt(note.commitment);
  const tree = buildTree(wallet);
  const ins = tree.insert(commitment);

  // sanity: our empty-tree oldRoot must equal the live pool root
  const poolRoot = hex(await simulateCall(POOL_ID, "current_root") as Uint8Array);
  if (poolRoot !== hex(toBytes32(ins.oldRoot))) throw new Error(`oldRoot mismatch — pool not fresh?\n pool ${poolRoot}\n ours ${hex(toBytes32(ins.oldRoot))}`);
  console.log("empty-tree oldRoot == live pool root ✓", poolRoot.slice(0, 14) + "…");

  const before = BigInt(await simulateCall(POOL_ID, "total_shielded") as any);

  // 2. real Groth16 deposit proof
  console.log("proving (Groth16 / BN254)…");
  const { proof } = await groth16.fullProve(
    { oldRoot: ins.oldRoot, newRoot: ins.newRoot, commitment, amount: AMT, sk: BigInt(note.sk), blinding: BigInt(note.blinding), pathElements: ins.pathElements, pathIndices: ins.pathIndices },
    "public/circuits/deposit.wasm", "public/circuits/deposit.zkey",
  );
  const sp = { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };
  const proofScVal = (await import("../lib/prover")).proofToScVal(sp);

  // 3. submit deposit (pulls AMT USDC from the depositor)
  const { hash } = await invoke(kp.publicKey(), POOL_ID, "deposit", [
    addr(kp.publicKey()), i128(AMT), bytesN32(toBytes32(commitment)),
    bytesN32(toBytes32(ins.oldRoot)), bytesN32(toBytes32(ins.newRoot)), proofScVal,
  ]);
  console.log("✅ deposit submitted:", "https://stellar.expert/explorer/testnet/tx/" + hash);

  // 4. assert
  const after = BigInt(await simulateCall(POOL_ID, "total_shielded") as any);
  const nextLeaf = Number(await simulateCall(POOL_ID, "next_leaf"));
  console.log(`total_shielded ${before} → ${after} (+${after - before}, expect ${AMT})`);
  console.log(`next_leaf now ${nextLeaf}`);
  if (after - before !== AMT) throw new Error("total_shielded did not grow by the deposit");
  console.log("\n🎉 DEPOSIT VERIFIED — a fresh wallet can shield into this pool.");
}
main().catch((e) => { console.error("DEPOSIT E2E FAILED:", e.message || e); process.exit(1); });
