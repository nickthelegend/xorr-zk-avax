// Backfill the delivery indexer (/leaves/:pool) from the pool's on-chain events,
// so a fresh single-user wallet rebuilds the exact tree and can deposit/spend
// (otherwise sync() sees 0 leaves → wrong oldRoot → StaleRoot).
//
// env: POOL_ID, DELIVERY_URL, STELLAR_RPC
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { buildTree, initCrypto, type WalletState } from "../lib/notes";
import { toBytes32 } from "../lib/poseidon";
import { simulateCall } from "../lib/stellar";

const POOL = process.env.POOL_ID || "CA5T3ZM6EFLSOFI5ZAWMN3CZV6U5I2BCCH2W6JSXNYCH3CVRG4BVFZ65";
const DELIVERY = process.env.DELIVERY_URL || "http://localhost:8787";
const RPC = process.env.STELLAR_RPC || "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC);
const hx = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");

// Each leaf-appending event: topic → the commitment(s) it inserts (in order).
function leavesFromEvent(topic: string, v: any): string[] {
  const a = Array.isArray(v) ? v : [v];
  const toLeaf = (c: any) => (c == null ? null : BigInt(hx(c as Uint8Array)).toString());
  let cmts: any[] = [];
  if (topic.includes("bridgein") || topic.includes("deposit")) cmts = [a[0]]; // (commitment, …)
  else if (topic.includes("withdraw")) cmts = [a[3]];                          // (recipient, amount, nf, change_cmt, root)
  else if (topic.includes("zkswap")) cmts = [a[3]];                            // (recipient, in, out, change_cmt, root)
  else if (topic.includes("transfer")) cmts = [a[2], a[3]];                    // (…, out_a, out_b)
  return cmts.map(toLeaf).filter((x): x is string => !!x);
}

async function main() {
  await initCrypto();

  // 1. scan all pool events from the earliest available ledger (paginated)
  const latest = (await server.getLatestLedger()).sequence;
  const start = Math.max(2, latest - 120_000);
  const collected: { ledger: number; order: number; leaf: string }[] = [];
  let cursor: string | undefined;
  let order = 0;
  while (true) {
    const req: any = cursor
      ? { cursor, filters: [{ type: "contract", contractIds: [POOL] }], limit: 200 }
      : { startLedger: start, filters: [{ type: "contract", contractIds: [POOL] }], limit: 200 };
    const page: any = await server.getEvents(req);
    const evs: any[] = page.events ?? [];
    for (const e of evs) {
      const tkey = String(e.topic.map((t: any) => { try { return scValToNative(t); } catch { return ""; } }));
      let val: any; try { val = scValToNative(e.value); } catch { continue; }
      for (const leaf of leavesFromEvent(tkey, val)) collected.push({ ledger: e.ledger, order: order++, leaf });
    }
    cursor = page.cursor;
    if (!evs.length || !cursor) break;
  }
  collected.sort((a, b) => (a.ledger - b.ledger) || (a.order - b.order));
  const leaves = collected.map((c) => c.leaf);
  console.log(`scanned events → ${leaves.length} leaves (scan window: ledgers ${start}–${latest})`);

  // 2. verify the rebuilt tree root matches the live pool root
  const tree = buildTree({ master: "1", nextIndex: 1, notes: [], leaves } as WalletState);
  const rebuilt = hx(toBytes32(tree.root));
  const onchain = hx(await simulateCall(POOL, "current_root") as Uint8Array);
  const nextLeaf = Number(await simulateCall(POOL, "next_leaf"));
  console.log(`rebuilt root ${rebuilt.slice(0, 14)}…  on-chain ${onchain.slice(0, 14)}…  (${leaves.length}/${nextLeaf} leaves)`);
  if (rebuilt !== onchain) {
    throw new Error(`root mismatch — reconstructed ${leaves.length} of ${nextLeaf} leaves; some events are outside the RPC retention window`);
  }
  console.log("✓ reconstructed tree matches the on-chain root");

  // 3. post to the indexer
  const body = { pool: POOL, leaves: leaves.map((commitment, index) => ({ index, commitment })) };
  const r = await fetch(`${DELIVERY}/leaves`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log("indexer /leaves ←", r.status, (await r.text()).slice(0, 120));
  console.log(`\n✅ backfilled ${leaves.length} leaves — a fresh wallet can now deposit (oldRoot will match).`);
}
main().catch((e) => { console.error("BACKFILL FAILED:", e.message || e); process.exit(1); });
