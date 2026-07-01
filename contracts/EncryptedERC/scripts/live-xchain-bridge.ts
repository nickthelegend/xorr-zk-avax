// LIVE cross-chain bridge: lock USDC on Ethereum Sepolia → mint confidential
// xUSD on Avalanche Fuji. The genuine two-chain corridor, end-to-end.
//
//   npx hardhat run scripts/live-xchain-bridge.ts --network fuji
//
// Runs on Fuji (hardhat ethers + zkit = the mint side); opens a separate Sepolia
// JSON-RPC provider for the source-chain lock. Same deployer key on both chains.
import { ethers, zkit } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { privateMint, getDecryptedBalance } from "../test/helpers";
import { User } from "../test/user";
import { SimpleERC20__factory, XorrBridge__factory } from "../typechain-types";
import type { RegistrationCircuit } from "../generated-types/zkit";

const dep = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", f), "utf8"));
const units = (n: number) => BigInt(Math.round(n * 100));
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);
const snow = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;
const etherscan = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

async function main() {
  const core = dep("fuji.json");
  const src = dep("sepolia.json");
  const pk = process.env.PRIVATE_KEY as string;

  // ── Fuji (destination / mint side) ────────────────────────────────────────
  const [owner] = await ethers.getSigners(); // relayer + eERC owner + auditor
  const fujiProvider = ethers.provider;
  const registrar = await ethers.getContractAt("Registrar", core.registrar);
  const eerc = await ethers.getContractAt("EncryptedERC", core.encryptedERC);
  const chainId = (await fujiProvider.getNetwork()).chainId;
  const regCircuit = (await zkit.getCircuit("RegistrationCircuit")) as unknown as RegistrationCircuit;

  // ── Sepolia (source / lock side) ──────────────────────────────────────────
  const sepProvider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  );
  const sepSigner = new ethers.Wallet(pk, sepProvider);
  const usdcSep = SimpleERC20__factory.connect(src.usdc, sepSigner);
  const bridgeSep = XorrBridge__factory.connect(src.bridge, sepSigner);

  console.log(`\nCross-chain bridge · Sepolia escrow ${src.bridge} → Fuji eERC ${core.encryptedERC}\n`);

  // Fresh recipient, registered on the Fuji eERC so it can receive xUSD.
  const recFuji = ethers.Wallet.createRandom().connect(fujiProvider);
  const recipient = new User(recFuji as any);
  console.log(`Recipient ${recFuji.address}`);
  await (await owner.sendTransaction({ to: recFuji.address, value: ethers.parseEther("0.2") })).wait();
  {
    const input = {
      SenderPrivateKey: recipient.formattedPrivateKey,
      SenderPublicKey: recipient.publicKey,
      SenderAddress: BigInt(recipient.signer.address),
      ChainID: chainId,
      RegistrationHash: recipient.genRegistrationHash(chainId),
    };
    const cd = await regCircuit.generateCalldata(await regCircuit.generateProof(input));
    await (await registrar.connect(recFuji as any).register({ proofPoints: cd.proofPoints, publicSignals: cd.publicSignals })).wait();
    console.log("Recipient registered on Fuji eERC.\n");
  }

  // 1) SOURCE (Sepolia): lock 25 USDC for the recipient.
  console.log("→ Sepolia: minting + locking 25.00 USDC…");
  await (await usdcSep.mint(sepSigner.address, units(25))).wait();
  await (await usdcSep.approve(src.bridge, units(25))).wait();
  const lockTx = await bridgeSep.lock(units(25), recFuji.address);
  const lrc = await lockTx.wait();
  console.log(`  locked on Sepolia · ${etherscan(lockTx.hash)}`);

  // 2) RELAYER: read the Sepolia Locked event, mint on Fuji.
  const ev = (await bridgeSep.queryFilter(bridgeSep.filters.Locked, lrc!.blockNumber, lrc!.blockNumber))[0];
  const amount = ev.args.amount as bigint;
  console.log(`\n→ Relayer saw Sepolia lock of ${fmt(amount)} USDC → minting xUSD on Fuji…`);
  const recPub = (await registrar.getUserPublicKey(recFuji.address)).map((x: bigint) => BigInt(x));
  const auditorPublicKey = (await eerc.auditorPublicKey()).map((x: bigint) => BigInt(x));
  const cd = await privateMint(amount, recPub, auditorPublicKey);
  const mintTx = await eerc
    .connect(owner)
    ["privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"](
      recFuji.address,
      { proofPoints: cd.proofPoints, publicSignals: cd.publicSignals },
    );
  await mintTx.wait();
  console.log(`  minted on Fuji · ${snow(mintTx.hash)}`);

  // 3) verify recipient's decrypted balance on Fuji.
  const b = await eerc.balanceOfStandalone(recFuji.address);
  const bal = await getDecryptedBalance(recipient.privateKey, b.amountPCTs, b.balancePCT, b.eGCT);
  console.log(`\nRecipient Fuji xUSD (decrypted): ${fmt(bal)}`);
  console.log(`Sepolia escrow TVL: ${fmt(await bridgeSep.totalLocked())} USDC`);
  console.log(
    bal === amount
      ? "\n✅ Genuine Sepolia → Fuji confidential bridge verified.\n"
      : "\n✗ balance mismatch\n",
  );
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
