// REAL reverse-bridge verification (Stellar → Ethereum), no mocks:
//   1. reconstruct the pool note tree from its on-chain leaves
//   2. bridge IN a note we control (real Sepolia lock + relayer mint) so we hold
//      a spendable shielded note
//   3. bridge OUT: generate a Withdraw proof that burns the note to the bridge
//      sink (value-conserving), POST it to the relayer, which submits the burn on
//      Stellar AND calls the escrow's relayer-gated release() on Ethereum
//   4. assert real USDC landed back on Ethereum (escrow Released + balance up) and
//      the shielded supply dropped on Stellar
//
// env: EVM_PRIVATE_KEY, ETH_USDC, ETH_ESCROW, POOL_ID, BRIDGE_SINK, RELAYER_URL,
//      SEPOLIA_RPC, LEAVES (comma-sep hex of current pool leaves)
import { groth16 } from "snarkjs";
import { ethers } from "ethers";
import { Address } from "@stellar/stellar-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { createNote, buildTree, deriveNullifier, publicKey, initCrypto, type WalletState } from "../lib/notes";
import { toBytes32, randomField } from "../lib/poseidon";
import { simulateCall } from "../lib/stellar";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const EVM_PK = need("EVM_PRIVATE_KEY");
const ETH_USDC = need("ETH_USDC");
const ETH_ESCROW = need("ETH_ESCROW");
const POOL_ID = need("POOL_ID");
const BRIDGE_SINK = need("BRIDGE_SINK");
const LEAVES = need("LEAVES").split(",").map((s) => s.trim()).filter(Boolean);
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://sepolia.gateway.tenderly.co,https://sepolia.drpc.org";
const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:8790";

const STELLAR_AMT = 50_000_000n; // 5 USDC @ 7 decimals
const ETH_AMT = 5_000_000n; // 5 USDC @ 6 decimals

const FP = 32;
const fpBytes = (dec: string) => { let v = BigInt(dec); const o = new Uint8Array(FP); for (let i = FP - 1; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const g1 = (p: string[]) => cat(fpBytes(p[0]), fpBytes(p[1]));
const fp2 = (c: string[]) => cat(fpBytes(c[1]), fpBytes(c[0]));
const g2 = (p: string[][]) => cat(fp2(p[0]), fp2(p[1]));
const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");
const poolRoot = async () => "0x" + Buffer.from(await simulateCall(POOL_ID, "current_root") as Uint8Array).toString("hex");
const poolTotal = async () => BigInt(await simulateCall(POOL_ID, "total_shielded") as any);

// Must equal the contract's fr_from_tag(keccak256(recipient.to_xdr(env))).
function recipientField(address: string): bigint {
  const tag = keccak_256(new Uint8Array(Address.fromString(address).toScVal().toXDR()));
  tag[0] &= 0x1f;
  let v = 0n; for (const b of tag) v = (v << 8n) | BigInt(b);
  return v;
}

async function main() {
  await initCrypto();
  const RPCS = SEPOLIA_RPC.split(",").map((s) => s.trim());
  const wprov = RPCS.map((u) => new ethers.providers.JsonRpcProvider(u));
  const w = new ethers.Wallet(EVM_PK, wprov[0]);
  const ethRecipient = w.address;
  const usdc = new ethers.Contract(ETH_USDC, ["function approve(address,uint256) returns(bool)", "function allowance(address,address) view returns(uint256)", "function balanceOf(address) view returns(uint256)"], w);
  const escrow = new ethers.Contract(ETH_ESCROW, ["function lock(uint256,bytes32) returns(uint256)", "event Locked(uint256 indexed nonce, uint256 amount, bytes32 commitment, address indexed from)", "function releasedNullifier(bytes32) view returns(bool)"], w);
  const waitReceipt = async (txp: any) => { const tx = await txp; const h = tx.hash || tx; for (let i = 0; i < 90; i++) { for (const p of wprov) { try { const r = await p.getTransactionReceipt(h); if (r && r.blockNumber) return r; } catch {} } await new Promise((r) => setTimeout(r, 2000)); } throw new Error("receipt timeout " + h); };

  // 1. reconstruct the pool tree from its on-chain leaves
  const wallet: WalletState = { master: randomField().toString(), nextIndex: 1, notes: [], leaves: LEAVES.map((h) => BigInt(h).toString()) };
  let tree = buildTree(wallet);
  if (hex(tree.rootBytes()) !== await poolRoot()) throw new Error(`tree reconstruction mismatch\n  pool ${await poolRoot()}\n  ours ${hex(tree.rootBytes())}`);
  console.log(`reconstructed tree (${LEAVES.length} leaves) root == live pool root ✓`);

  // 2. bridge IN a note we control (real lock + relayer mint)
  const note = createNote(BigInt(wallet.master), 1, STELLAR_AMT);
  const commitment = BigInt(note.commitment);
  const insIn = tree.insert(commitment);
  console.log("\n[bridge-in] note commitment:", hex(toBytes32(commitment)));
  const allowance = BigInt((await usdc.allowance(ethRecipient, ETH_ESCROW)).toString());
  if (allowance < ETH_AMT) { console.log("  approving…"); await waitReceipt(usdc.approve(ETH_ESCROW, ETH_AMT.toString())); }
  const lr = await waitReceipt(escrow.lock(ETH_AMT.toString(), hex(toBytes32(commitment))));
  console.log("  Sepolia lock:", "https://sepolia.etherscan.io/tx/" + lr.transactionHash);
  const proofIn = (await groth16.fullProve(
    { oldRoot: insIn.oldRoot, newRoot: insIn.newRoot, commitment, amount: STELLAR_AMT, sk: BigInt(note.sk), blinding: BigInt(note.blinding), pathElements: insIn.pathElements, pathIndices: insIn.pathIndices },
    "public/circuits/deposit.wasm", "public/circuits/deposit.zkey")).proof;
  const resIn = await (await fetch(RELAYER_URL + "/bridge-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ethTx: lr.transactionHash, commitment: hex(toBytes32(commitment)), amount: STELLAR_AMT.toString(), oldRoot: hex(toBytes32(insIn.oldRoot)), newRoot: hex(toBytes32(insIn.newRoot)), proof: { a: hex(g1(proofIn.pi_a)), b: hex(g2(proofIn.pi_b)), c: hex(g1(proofIn.pi_c)) } }) })).json();
  if (resIn.error) throw new Error("bridge-in failed: " + resIn.error);
  note.leafIndex = insIn.index;
  wallet.leaves.push(commitment.toString());
  console.log("  ✅ minted on Stellar:", "https://stellar.expert/explorer/testnet/tx/" + resIn.stellarTx, "→ note at leaf", insIn.index);

  const balBefore = BigInt((await usdc.balanceOf(ethRecipient)).toString());
  const totalBefore = await poolTotal();

  // 3. bridge OUT — burn the note to the sink, relayer releases on Ethereum
  console.log("\n[bridge-out] generating Withdraw proof (burn → sink)…");
  tree = buildTree(wallet); // now includes our note
  const mem = tree.proof(note.leafIndex!);
  const oldRoot = tree.root;
  const changeNote = createNote(BigInt(wallet.master), 2, 0n); // full burn → 0 change
  const changeCmt = BigInt(changeNote.commitment);
  const insOut = tree.insert(changeCmt);
  const nf = deriveNullifier(commitment, BigInt(note.sk));
  const proofOut = (await groth16.fullProve({
    oldRoot, newRoot: insOut.newRoot, nullifier: nf, changeCommitment: changeCmt, amount: STELLAR_AMT,
    recipientField: recipientField(BRIDGE_SINK),
    inAmount: STELLAR_AMT, inSk: BigInt(note.sk), inBlinding: BigInt(note.blinding),
    inPathElements: mem.pathElements, inPathIndices: mem.pathIndices,
    changeAmount: 0n, changePk: publicKey(BigInt(changeNote.sk)), changeBlinding: BigInt(changeNote.blinding),
    changeInsPathElements: insOut.pathElements, changeInsPathIndices: insOut.pathIndices,
  }, "public/circuits/withdraw.wasm", "public/circuits/withdraw.zkey")).proof;

  console.log("POST", RELAYER_URL + "/bridge-out  (relayer burns on Stellar + releases on Ethereum)…");
  const resOut = await (await fetch(RELAYER_URL + "/bridge-out", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    recipient: BRIDGE_SINK, amount: STELLAR_AMT.toString(), nullifier: hex(toBytes32(nf)),
    changeCommitment: hex(toBytes32(changeCmt)), oldRoot: hex(toBytes32(oldRoot)), newRoot: hex(toBytes32(insOut.newRoot)),
    proof: { a: hex(g1(proofOut.pi_a)), b: hex(g2(proofOut.pi_b)), c: hex(g1(proofOut.pi_c)) }, ethRecipient,
  }) })).json();
  if (resOut.error) throw new Error("bridge-out failed: " + resOut.error);
  console.log("  ✅ Stellar burn:", "https://stellar.expert/explorer/testnet/tx/" + resOut.stellarTx);
  console.log("  ✅ Ethereum release:", "https://sepolia.etherscan.io/tx/" + resOut.ethTx, `(${Number(resOut.ethAmount) / 1e6} USDC)`);

  // 4. assert real movement on both chains
  const balAfter = BigInt((await usdc.balanceOf(ethRecipient)).toString());
  const totalAfter = await poolTotal();
  const nfUsed = await escrow.releasedNullifier(hex(toBytes32(nf)));
  const okEth = balAfter - balBefore === ETH_AMT;
  const okStellar = totalBefore - totalAfter === STELLAR_AMT;
  console.log(`\nEthereum USDC balance +${(Number(balAfter - balBefore)) / 1e6}  ${okEth ? "✓" : "✗"} (expect +5)`);
  console.log(`Stellar total_shielded ${totalBefore} → ${totalAfter}  ${okStellar ? "✓" : "✗"} (−${Number(STELLAR_AMT)})`);
  console.log(`escrow.releasedNullifier == true (single-use)  ${nfUsed ? "✓" : "✗"}`);
  if (!okEth || !okStellar || !nfUsed) throw new Error("reverse post-conditions failed");
  console.log("\n🎉 REVERSE ROUND-TRIP VERIFIED: xUSDC burned on Stellar (ZK) → real USDC released on Ethereum.");
}

main().catch((e) => { console.error("BRIDGE-OUT E2E FAILED:", e); process.exit(1); });
