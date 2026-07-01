// LIVE Fuji bridge cycle: a user locks USDC on the escrow, and the relayer
// mints the confidential xUSD equivalent to a freshly-registered recipient on
// the eERC. Proves the full lock-and-mint bridge end-to-end on-chain.
//
//   npx hardhat run scripts/live-bridge.ts --network fuji
import { ethers, zkit } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { privateMint, getDecryptedBalance } from "../test/helpers";
import { User } from "../test/user";
import type { RegistrationCircuit } from "../generated-types/zkit";

const dep = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", f), "utf8"));
const units = (n: number) => BigInt(Math.round(n * 100));
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);
const tx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;

async function main() {
  const core = dep("fuji.json");
  const defi = dep("fuji-defi.json");
  const [owner] = await ethers.getSigners(); // relayer + eERC owner + auditor + USDC holder
  const provider = ethers.provider;

  const registrar = await ethers.getContractAt("Registrar", core.registrar);
  const eerc = await ethers.getContractAt("EncryptedERC", core.encryptedERC);
  const usdc = await ethers.getContractAt("SimpleERC20", defi.usdc);
  const bridge = await ethers.getContractAt("XorrBridge", defi.bridge);
  const chainId = (await provider.getNetwork()).chainId;
  const regCircuit = (await zkit.getCircuit("RegistrationCircuit")) as unknown as RegistrationCircuit;

  console.log(`\nLive Fuji bridge · escrow ${defi.bridge} → eERC ${core.encryptedERC}\n`);

  // Fresh recipient, funded + registered on the eERC (so it can receive xUSD).
  const recW = ethers.Wallet.createRandom().connect(provider);
  const recipient = new User(recW as any);
  console.log(`Recipient ${recW.address}`);
  await (await owner.sendTransaction({ to: recW.address, value: ethers.parseEther("0.2") })).wait();
  {
    const input = {
      SenderPrivateKey: recipient.formattedPrivateKey,
      SenderPublicKey: recipient.publicKey,
      SenderAddress: BigInt(recipient.signer.address),
      ChainID: chainId,
      RegistrationHash: recipient.genRegistrationHash(chainId),
    };
    const cd = await regCircuit.generateCalldata(await regCircuit.generateProof(input));
    await (await registrar.connect(recW as any).register({ proofPoints: cd.proofPoints, publicSignals: cd.publicSignals })).wait();
    console.log("Recipient registered on eERC.");
  }

  // 1) user (owner) locks 40 USDC on the source escrow for the recipient.
  await (await usdc.mint(owner.address, units(40))).wait();
  await (await usdc.approve(bridge.target, units(40))).wait();
  const lockTx = await bridge.lock(units(40), recW.address);
  const rc = await lockTx.wait();
  console.log(`\nLocked 40.00 USDC → escrow · ${tx(lockTx.hash)}`);

  // 2) relayer reads the Locked event and mints the confidential equivalent.
  const ev = (await bridge.queryFilter(bridge.filters.Locked, rc!.blockNumber, rc!.blockNumber))[0];
  const amount = ev.args.amount as bigint;
  const recPub = (await registrar.getUserPublicKey(recW.address)).map((x: bigint) => BigInt(x));
  const auditorPublicKey = (await eerc.auditorPublicKey()).map((x: bigint) => BigInt(x));
  console.log("Relayer minting confidential xUSD…");
  const cd = await privateMint(amount, recPub, auditorPublicKey);
  const mintTx = await eerc
    .connect(owner)
    ["privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"](
      recW.address,
      { proofPoints: cd.proofPoints, publicSignals: cd.publicSignals },
    );
  await mintTx.wait();
  console.log(`Relayer minted 40.00 xUSD → recipient · ${tx(mintTx.hash)}`);

  // 3) verify the recipient's decrypted balance.
  const b = await eerc.balanceOfStandalone(recW.address);
  const bal = await getDecryptedBalance(recipient.privateKey, b.amountPCTs, b.balancePCT, b.eGCT);
  console.log(`\nRecipient decrypted xUSD balance: ${fmt(bal)}`);
  console.log(`Escrow TVL: ${fmt(await bridge.totalLocked())} USDC`);
  console.log(bal === amount ? "\n✅ Bridge in verified live on Fuji.\n" : "\n✗ balance mismatch\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
