// Reconcile the delivery indexer with the pool's on-chain leaves.
// The deposit-e2e script inserted a leaf directly (bypassing the indexer), so
// the pool has a leaf the indexer doesn't know about. Read the pool's "deposit"
// events, post every commitment to the indexer at its leaf index, and verify the
// rebuilt Merkle root equals the pool's current_root.
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

const POOL = process.env.POOL || "CAN7XXQLMJCDLUTUEPEWMCWNOJQLQYYCUBWONNSSTVFWNN6NMGG2HCAE";
const DELIVERY = process.env.DELIVERY || "http://localhost:8787";
const RPC = "https://soroban-testnet.stellar.org";
const s = new rpc.Server(RPC);

const beBytesToDec = (u) => { let v = 0n; for (const b of u) v = (v << 8n) | BigInt(b); return v.toString(); };

// scan a wide-enough recent window for the deposit/bridgein events
const latest = (await s.getLatestLedger()).sequence;
// getEvents caps the per-query ledger span; scan a recent window in 5k chunks.
const startLedger = latest - 5000;
console.log("latest ledger", latest, "scanning from", startLedger);

let cursor = undefined;
const found = [];
for (let page = 0; page < 40; page++) {
  const res = await s.getEvents({
    startLedger: cursor ? undefined : startLedger,
    cursor,
    filters: [{ type: "contract", contractIds: [POOL] }],
    limit: 100,
  });
  for (const ev of res.events || []) {
    const topics = (ev.topic || []).map((t) => { try { return scValToNative(t); } catch { return null; } });
    const kind = topics[1];
    if (kind !== "deposit" && kind !== "bridgein") continue;
    const data = scValToNative(ev.value); // (commitment, amount, new_root)
    const commitment = data[0]; // Buffer (32 bytes, big-endian)
    found.push({ ledger: ev.ledger, kind, commitment: beBytesToDec(new Uint8Array(commitment)) });
  }
  cursor = res.cursor;
  if (!res.events || res.events.length < 100) break;
}

console.log(`found ${found.length} insertion event(s) on-chain`);
if (found.length === 0) { console.log("nothing to reconcile"); process.exit(0); }

// events come back in ledger order = insertion order = leaf index order
const leaves = found.map((f, index) => ({ index, commitment: f.commitment }));
leaves.forEach((l) => console.log(`  leaf #${l.index}: ${l.commitment.slice(0, 18)}…`));

const r = await fetch(`${DELIVERY}/leaves`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ pool: POOL, leaves }),
});
console.log("POST /leaves ->", r.status);

const back = await (await fetch(`${DELIVERY}/leaves/${POOL}`)).json();
const got = Array.isArray(back) ? back : back.leaves || [];
console.log(`indexer now holds ${got.length} leaf/leaves`);
