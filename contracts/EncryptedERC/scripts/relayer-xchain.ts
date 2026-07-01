// XORR cross-chain bridge relayer: watches the SOURCE escrow on Ethereum Sepolia
// for `Locked` events and mints the confidential xUSD equivalent on the
// DESTINATION eERC (Avalanche Fuji). This is the genuine two-chain bridge.
//
//   npx hardhat run scripts/relayer-xchain.ts --network fuji
//
// Runs on the Fuji network (hardhat `ethers` + zkit are the Fuji/mint side); it
// opens a separate JSON-RPC provider to read Sepolia. Relayer = deployer key on
// both chains.
import { ethers, zkit } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { privateMint } from "../test/helpers";
import { XorrBridge__factory } from "../typechain-types";

const dep = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", f), "utf8"));
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const core = dep("fuji.json");
  const src = dep("sepolia.json"); // deployed by deploy-sepolia-bridge.ts

  // Fuji (destination): mint side.
  const [relayer] = await ethers.getSigners();
  const registrar = await ethers.getContractAt("Registrar", core.registrar);
  const eerc = await ethers.getContractAt("EncryptedERC", core.encryptedERC);
  const auditorPublicKey = (await eerc.auditorPublicKey()).map((x: bigint) => BigInt(x));

  // Sepolia (source): read-only bridge via its own provider.
  const sepoliaRpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const srcProvider = new ethers.JsonRpcProvider(sepoliaRpc);
  const srcBridge = XorrBridge__factory.connect(src.bridge, srcProvider);

  console.log(`XORR x-chain relayer up`);
  console.log(`  source  : Sepolia bridge ${src.bridge}`);
  console.log(`  dest    : Fuji eERC ${core.encryptedERC}`);
  console.log(`  relayer : ${relayer.address}\n`);

  const done = new Set<string>();
  let from = await srcProvider.getBlockNumber();
  console.log(`Watching Sepolia from block ${from}…\n`);

  for (;;) {
    try {
      const to = await srcProvider.getBlockNumber();
      if (to >= from) {
        const events = await srcBridge.queryFilter(srcBridge.filters.Locked, from, to);
        for (const ev of events) {
          const id = ev.args.id.toString();
          if (done.has(id)) continue;
          const recipient = ev.args.fujiRecipient as string;
          const amount = ev.args.amount as bigint;
          console.log(`Sepolia lock #${id}: ${fmt(amount)} USDC → ${recipient.slice(0, 8)}…`);
          if (!(await registrar.isUserRegistered(recipient))) {
            console.log(`  ⚠ recipient not registered on Fuji eERC — skipping`);
            done.add(id);
            continue;
          }
          const pub = (await registrar.getUserPublicKey(recipient)).map((x: bigint) => BigInt(x));
          const cd = await privateMint(amount, pub, auditorPublicKey);
          const mt = await eerc
            .connect(relayer)
            ["privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"](
              recipient,
              { proofPoints: cd.proofPoints, publicSignals: cd.publicSignals },
            );
          await mt.wait();
          console.log(`  ✓ minted ${fmt(amount)} xUSD on Fuji · https://testnet.snowtrace.io/tx/${mt.hash}`);
          done.add(id);
        }
        from = to + 1;
      }
    } catch (e) {
      console.error("relayer error:", (e as Error).message);
    }
    await sleep(12000);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
