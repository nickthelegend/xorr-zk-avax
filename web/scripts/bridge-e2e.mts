// REAL end-to-end bridge verification (ETH → Stellar), no mocks:
//   1. generate a shielded note (fresh single-user wallet)
//   2. lock real USDC on Sepolia into the escrow, bound to the note commitment
//   3. generate the deposit/Bridge Groth16 proof (snarkjs, real .wasm/.zkey)
//   4. submit bridge_in to the Stellar bridge, signed as the relayer (xorr)
//   5. assert the pool minted the note (root advanced, total_shielded == amount)
//
// env: XORR_SECRET, EVM_PRIVATE_KEY, ETH_USDC, ETH_ESCROW, BRIDGE_ID, POOL_ID, SEPOLIA_RPC
import { groth16 } from "snarkjs";
import { ethers } from "ethers";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { createNote, buildTree, initCrypto, type WalletState } from "../lib/notes";
import { toBytes32, randomField } from "../lib/poseidon";
import { bytesN32, u64, i128, invoke, simulateCall, setSigner } from "../lib/stellar";
import { proofToScVal } from "../lib/prover";
import { NETWORK_PASSPHRASE } from "../lib/config";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const XORR_SECRET = need("XORR_SECRET");
const EVM_PK = need("EVM_PRIVATE_KEY");
const ETH_USDC = need("ETH_USDC");
const ETH_ESCROW = need("ETH_ESCROW");
const BRIDGE_ID = need("BRIDGE_ID");
const POOL_ID = need("POOL_ID");
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";

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
  await initCrypto(); // init Poseidon (BN254) before deriving keys
  const kp = Keypair.fromSecret(XORR_SECRET);
  setSigner(async (xdrStr: string) => { const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK_PASSPHRASE); tx.sign(kp); return tx.toXDR(); });
  console.log("relayer (Stellar):", kp.publicKey());

  // 1. fresh single-user wallet + note
  const wallet: WalletState = { master: randomField().toString(), nextIndex: 1, notes: [], leaves: [] };
  const note = createNote(BigInt(wallet.master), 0, STELLAR_AMT);
  const commitment = BigInt(note.commitment);
  const tree = buildTree(wallet);
  const ins = tree.insert(commitment);
  console.log("note commitment:", hex(toBytes32(commitment)));

  // sanity: our empty-tree oldRoot must equal the live pool root (pool is fresh)
  const poolRoot = await simulateCall(POOL_ID, "current_root");
  const poolRootHex = "0x" + Buffer.from(poolRoot as Uint8Array).toString("hex");
  if (poolRootHex !== hex(toBytes32(ins.oldRoot))) throw new Error(`oldRoot mismatch — pool not fresh?\n pool ${poolRootHex}\n ours ${hex(toBytes32(ins.oldRoot))}`);
  console.log("oldRoot == live pool root ✓");

  // 2. lock real USDC on Sepolia, bound to the commitment
  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
  const w = new ethers.Wallet(EVM_PK, provider);
  const usdc = new ethers.Contract(ETH_USDC, ["function approve(address,uint256) returns (bool)"], w);
  const escrow = new ethers.Contract(ETH_ESCROW, ["function lock(uint256,bytes32) returns (uint256)", "event Locked(uint256 indexed nonce, uint256 amount, bytes32 commitment, address indexed from)"], w);
  await (await usdc.approve(ETH_ESCROW, ETH_AMT.toString())).wait();
  const ltx = await escrow.lock(ETH_AMT.toString(), hex(toBytes32(commitment)));
  const lr = await ltx.wait();
  const ev = lr.logs.map((l: any) => { try { return escrow.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "Locked");
  const ethNonce = BigInt(ev.args.nonce.toString());
  console.log(`\n✅ Sepolia LOCK  ${Number(ETH_AMT) / 1e6} USDC  nonce=${ethNonce}`);
  console.log("   https://sepolia.etherscan.io/tx/" + ltx.hash);

  // 3. real Groth16 proof (Bridge == deposit circuit)
  console.log("\nproving (Groth16 / BN254)…");
  const { proof } = await groth16.fullProve(
    { oldRoot: ins.oldRoot, newRoot: ins.newRoot, commitment, amount: STELLAR_AMT, sk: BigInt(note.sk), blinding: BigInt(note.blinding), pathElements: ins.pathElements, pathIndices: ins.pathIndices },
    "public/circuits/deposit.wasm",
    "public/circuits/deposit.zkey",
  );
  const sp = { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };

  // 4. relayer submits bridge_in on Stellar
  const { hash } = await invoke(kp.publicKey(), BRIDGE_ID, "bridge_in", [
    u64(ethNonce),
    i128(STELLAR_AMT),
    bytesN32(toBytes32(commitment)),
    bytesN32(toBytes32(ins.oldRoot)),
    bytesN32(toBytes32(ins.newRoot)),
    proofToScVal(sp),
  ]);
  console.log(`\n✅ Stellar bridge_in (ZK verified on-chain)`);
  console.log("   https://stellar.expert/explorer/testnet/tx/" + hash);

  // 5. assert the mint landed in the app pool
  const total = await simulateCall(POOL_ID, "total_shielded");
  const newRootHex = await simulateCall(POOL_ID, "current_root");
  const okTotal = BigInt(total as any) === STELLAR_AMT;
  const okRoot = "0x" + Buffer.from(newRootHex as Uint8Array).toString("hex") === hex(toBytes32(ins.newRoot));
  console.log(`\npool.total_shielded = ${total} (expect ${STELLAR_AMT})  ${okTotal ? "✓" : "✗"}`);
  console.log(`pool.current_root advanced to our newRoot  ${okRoot ? "✓" : "✗"}`);
  if (!okTotal || !okRoot) throw new Error("post-conditions failed");
  console.log("\n🎉 REAL ROUND-TRIP VERIFIED: 5 USDC locked on Sepolia → 5 xUSDC minted (ZK) on Stellar.");
}

main().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
