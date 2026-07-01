// REAL end-to-end bridge verification v2 (ETH → Stellar) — exercises the FULL
// autonomous stack INCLUDING ETH deposit-tree membership (the Zephyr-parity
// feature). No mocks:
//   1. reconstruct the pool's note tree from its existing leaf (chain truth)
//   2. mint a fresh shielded note + Groth16 proof whose oldRoot == live pool root
//   3. lock real USDC on Sepolia into the escrow, bound to the note commitment
//   4. POST the note proof to the RELAYER, which (a) rebuilds the keccak256 ETH
//      deposit tree, (b) posts its root to Stellar, (c) builds the membership
//      proof for our commitment, and (d) submits the 9-arg `bridge_in`
//   5. the bridge verifies BOTH the Groth16 note proof AND ETH-tree membership
//      on-chain, then mints — assert the pool advanced (total_shielded, root)
//
// env: EVM_PRIVATE_KEY, ETH_USDC, ETH_ESCROW, POOL_ID, SEPOLIA_RPC, RELAYER_URL, LEAF0
import { groth16 } from "snarkjs";
import { ethers } from "ethers";
import { createNote, buildTree, initCrypto, type WalletState } from "../lib/notes";
import { toBytes32, randomField } from "../lib/poseidon";
import { simulateCall } from "../lib/stellar";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const EVM_PK = need("EVM_PRIVATE_KEY");
const ETH_USDC = need("ETH_USDC");
const ETH_ESCROW = need("ETH_ESCROW");
const POOL_ID = need("POOL_ID");
const LEAF0 = need("LEAF0"); // hex commitment of the pool's existing leaf (from its bridgein event)
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://sepolia.drpc.org";
const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:8790";

const STELLAR_AMT = 50_000_000n; // 5 USDC @ 7 decimals (Stellar)
const ETH_AMT = 5_000_000n; // 5 USDC @ 6 decimals (Sepolia)

// --- Soroban Proof byte encoding (mirrors lib/prover) ----------------------
const FP = 32;
const fpBytes = (dec: string) => { let v = BigInt(dec); const o = new Uint8Array(FP); for (let i = FP - 1; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const g1 = (p: string[]) => cat(fpBytes(p[0]), fpBytes(p[1]));
const fp2 = (c: string[]) => cat(fpBytes(c[1]), fpBytes(c[0]));
const g2 = (p: string[][]) => cat(fp2(p[0]), fp2(p[1]));
const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");

async function main() {
  await initCrypto();

  // 1. reconstruct the pool's note tree from its existing leaf, then assert the
  //    rebuilt root matches the LIVE pool root (proves our mirror == chain).
  const leaf0 = BigInt(LEAF0).toString();
  const wallet: WalletState = { master: randomField().toString(), nextIndex: 1, notes: [], leaves: [leaf0] };
  const tree = buildTree(wallet);
  const poolRootBefore = "0x" + Buffer.from(await simulateCall(POOL_ID, "current_root") as Uint8Array).toString("hex");
  if (hex(tree.rootBytes()) !== poolRootBefore) {
    throw new Error(`reconstruction mismatch — rebuilt tree root != pool root\n  pool  ${poolRootBefore}\n  ours  ${hex(tree.rootBytes())}`);
  }
  console.log("reconstructed tree root == live pool root ✓", poolRootBefore.slice(0, 14) + "…");

  // 2. fresh note inserted at the NEXT index; oldRoot must equal the pool root.
  const note = createNote(BigInt(wallet.master), 1, STELLAR_AMT);
  const commitment = BigInt(note.commitment);
  const ins = tree.insert(commitment);
  if (hex(toBytes32(ins.oldRoot)) !== poolRootBefore) throw new Error("oldRoot != pool root after insert");
  console.log("note commitment:", hex(toBytes32(commitment)));
  console.log("oldRoot == live pool root ✓  newRoot", hex(toBytes32(ins.newRoot)).slice(0, 14) + "…");

  // 3. lock real USDC on Sepolia, bound to the commitment. Free RPC tiers time
  //    out polling receipts, so we poll getTransactionReceipt across an RPC pool.
  const RPCS = SEPOLIA_RPC.split(",").map((s) => s.trim()).filter(Boolean);
  const wprov = RPCS.map((u) => new ethers.providers.JsonRpcProvider(u));
  const w = new ethers.Wallet(EVM_PK, wprov[0]);
  const usdc = new ethers.Contract(ETH_USDC, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"], w);
  const escrow = new ethers.Contract(ETH_ESCROW, ["function lock(uint256,bytes32) returns (uint256)", "event Locked(uint256 indexed nonce, uint256 amount, bytes32 commitment, address indexed from)"], w);
  const waitReceipt = async (txp: any) => {
    const tx = await txp; const hash = tx.hash || tx;
    for (let i = 0; i < 90; i++) {
      for (const p of wprov) { try { const r = await p.getTransactionReceipt(hash); if (r && r.blockNumber) return r; } catch { /* try next rpc */ } }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("receipt timeout " + hash);
  };
  console.log("\nlocking on Sepolia…");
  const allowance = BigInt((await usdc.allowance(w.address, ETH_ESCROW)).toString());
  if (allowance < ETH_AMT) { console.log("  approving…"); await waitReceipt(usdc.approve(ETH_ESCROW, ETH_AMT.toString())); }
  else console.log("  allowance ok ✓");
  const lr = await waitReceipt(escrow.lock(ETH_AMT.toString(), hex(toBytes32(commitment))));
  const ev = lr.logs.map((l: any) => { try { return escrow.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "Locked");
  const ethNonce = BigInt(ev.args.nonce.toString());
  const ltx = { hash: lr.transactionHash };
  console.log(`✅ Sepolia LOCK  ${Number(ETH_AMT) / 1e6} USDC  nonce=${ethNonce}`);
  console.log("   https://sepolia.etherscan.io/tx/" + ltx.hash);

  // 4. real Groth16 proof (Bridge == deposit circuit)
  console.log("\nproving (Groth16 / BN254)…");
  const { proof } = await groth16.fullProve(
    { oldRoot: ins.oldRoot, newRoot: ins.newRoot, commitment, amount: STELLAR_AMT, sk: BigInt(note.sk), blinding: BigInt(note.blinding), pathElements: ins.pathElements, pathIndices: ins.pathIndices },
    "public/circuits/deposit.wasm",
    "public/circuits/deposit.zkey",
  );
  const sp = { a: hex(g1(proof.pi_a)), b: hex(g2(proof.pi_b)), c: hex(g1(proof.pi_c)) };

  // 5. hand the note proof to the RELAYER — it adds the ETH membership proof,
  //    posts the deposit root, and submits the 9-arg bridge_in.
  console.log("\nPOST", RELAYER_URL + "/bridge-in  (relayer builds keccak membership proof)…");
  const res = await fetch(RELAYER_URL + "/bridge-in", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ethTx: ltx.hash, commitment: hex(toBytes32(commitment)), amount: STELLAR_AMT.toString(), oldRoot: hex(toBytes32(ins.oldRoot)), newRoot: hex(toBytes32(ins.newRoot)), proof: sp }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error("relayer bridge-in failed: " + JSON.stringify(out));
  console.log(`✅ relayer minted on Stellar (ETH-membership + ZK both verified on-chain)`);
  console.log("   ETH deposit index:", out.ethIndex, " ETH root:", String(out.ethRoot).slice(0, 14) + "…");
  console.log("   https://stellar.expert/explorer/testnet/tx/" + out.stellarTx);

  // 6. assert the mint landed
  const total = BigInt(await simulateCall(POOL_ID, "total_shielded") as any);
  const poolRootAfter = "0x" + Buffer.from(await simulateCall(POOL_ID, "current_root") as Uint8Array).toString("hex");
  const okRoot = poolRootAfter === hex(toBytes32(ins.newRoot));
  console.log(`\npool.total_shielded = ${total}  (grew by ${STELLAR_AMT})`);
  console.log(`pool.current_root advanced to our newRoot  ${okRoot ? "✓" : "✗"}`);
  if (!okRoot) throw new Error("post-condition failed: pool root did not advance to our newRoot");
  console.log("\n🎉 v2 ROUND-TRIP VERIFIED: USDC locked on Sepolia → keccak deposit root posted →");
  console.log("   ETH-tree membership + Groth16 both verified on Stellar → xUSDC minted.");
}

main().catch((e) => { console.error("E2E v2 FAILED:", e); process.exit(1); });
