// XORR bridge relayer — watches the source escrow for `Locked` events and mints
// the confidential xUSD equivalent to the recipient on the eERC (Fuji).
//
//   npx hardhat run scripts/relayer.ts --network fuji
//
// Runs as the eERC owner/auditor (the deployer key). Polls for new locks and
// privateMints to each recipient's registered eERC public key.
import { ethers, zkit } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { privateMint } from "../test/helpers";

const dep = (f: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", f), "utf8"));
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);
const tx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const core = dep("fuji.json");
  const defi = dep("fuji-defi.json");
  const [relayer] = await ethers.getSigners();
  const registrar = await ethers.getContractAt("Registrar", core.registrar);
  const eerc = await ethers.getContractAt("EncryptedERC", core.encryptedERC);
  const bridge = await ethers.getContractAt("XorrBridge", defi.bridge);

  const auditorPublicKey = (await eerc.auditorPublicKey()).map((x: bigint) => BigInt(x));
  console.log(`XORR relayer up · bridge ${defi.bridge} → eERC ${core.encryptedERC}`);
  console.log(`Relayer/auditor ${relayer.address}\n`);

  const done = new Set<string>();
  let from = await ethers.provider.getBlockNumber();

  // Warm-start: settle any locks that already happened this session start.
  for (;;) {
    try {
      const to = await ethers.provider.getBlockNumber();
      if (to >= from) {
        const events = await bridge.queryFilter(bridge.filters.Locked, from, to);
        for (const ev of events) {
          const id = ev.args.id.toString();
          if (done.has(id)) continue;
          const recipient = ev.args.fujiRecipient as string;
          const amount = ev.args.amount as bigint;
          if (!(await registrar.isUserRegistered(recipient))) {
            console.log(`  lock #${id}: recipient ${recipient.slice(0, 8)}… not registered on eERC — skipping`);
            done.add(id);
            continue;
          }
          const pub = (await registrar.getUserPublicKey(recipient)).map((x: bigint) => BigInt(x));
          console.log(`  lock #${id}: minting ${fmt(amount)} xUSD → ${recipient.slice(0, 8)}…`);
          const cd = await privateMint(amount, pub, auditorPublicKey);
          const mt = await eerc
            .connect(relayer)
            [
              "privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"
            ](recipient, { proofPoints: cd.proofPoints, publicSignals: cd.publicSignals });
          await mt.wait();
          console.log(`    ✓ minted · ${tx(mt.hash)}`);
          done.add(id);
        }
        from = to + 1;
      }
    } catch (e) {
      console.error("relayer error:", (e as Error).message);
    }
    await sleep(8000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
