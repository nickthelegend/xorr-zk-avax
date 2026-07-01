// LIVE Fuji integration: register two fresh wallets (Alice, Bob), mint
// confidential xUSD to Alice, and have Alice privately pay Bob — all against the
// deployed EncryptedERC. Prints Snowtrace links + locally-decrypted balances.
//
//   npx hardhat run scripts/live-mint-pay.ts --network fuji
//
// The deployer (from .env PRIVATE_KEY) is the owner/auditor and funds gas for
// the two new wallets.
import { ethers, zkit } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { privateMint, privateTransfer, getDecryptedBalance } from "../test/helpers";
import { User } from "../test/user";
import type { RegistrationCircuit } from "../generated-types/zkit";

const xusd = (n: number) => BigInt(Math.round(n * 100));
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);
const tx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "fuji.json"), "utf8"),
  );
  const [owner] = await ethers.getSigners();
  const provider = ethers.provider;
  console.log(`\nLive Fuji · EncryptedERC ${dep.encryptedERC}`);
  console.log(`Owner/auditor/funder: ${owner.address}\n`);

  const registrar = await ethers.getContractAt("Registrar", dep.registrar);
  const eerc = await ethers.getContractAt("EncryptedERC", dep.encryptedERC);
  const chainId = (await provider.getNetwork()).chainId;
  const regCircuit = (await zkit.getCircuit("RegistrationCircuit")) as unknown as RegistrationCircuit;

  // Two fresh wallets, funded for gas from the owner.
  const aliceW = ethers.Wallet.createRandom().connect(provider);
  const bobW = ethers.Wallet.createRandom().connect(provider);
  console.log(`Alice ${aliceW.address}\nBob   ${bobW.address}\n`);
  for (const w of [aliceW, bobW]) {
    await (await owner.sendTransaction({ to: w.address, value: ethers.parseEther("0.25") })).wait();
  }
  console.log("Funded Alice & Bob with 0.25 AVAX each for gas.\n");

  const auditor = new User(owner as any);
  const alice = new User(aliceW as any);
  const bob = new User(bobW as any);

  async function register(u: User, who: string) {
    if (await registrar.isUserRegistered(u.signer.address)) {
      console.log(`${who} already registered`);
      return;
    }
    const input = {
      SenderPrivateKey: u.formattedPrivateKey,
      SenderPublicKey: u.publicKey,
      SenderAddress: BigInt(u.signer.address),
      ChainID: chainId,
      RegistrationHash: u.genRegistrationHash(chainId),
    };
    const proof = await regCircuit.generateProof(input);
    const cd = await regCircuit.generateCalldata(proof);
    const t = await registrar
      .connect(u.signer as any)
      .register({ proofPoints: cd.proofPoints, publicSignals: cd.publicSignals });
    await t.wait();
    console.log(`${who} registered · ${tx(t.hash)}`);
  }

  async function decBalance(u: User) {
    const b = await eerc.balanceOfStandalone(u.signer.address);
    return getDecryptedBalance(u.privateKey, b.amountPCTs, b.balancePCT, b.eGCT);
  }

  // 1) register owner(=auditor), Alice, Bob
  await register(auditor, "Owner/auditor");
  await register(alice, "Alice");
  await register(bob, "Bob");

  // 2) set auditor (owner)
  if (!(await eerc.isAuditorKeySet())) {
    const t = await eerc.connect(owner).setAuditorPublicKey(owner.address);
    await t.wait();
    console.log(`Auditor set · ${tx(t.hash)}`);
  }
  const auditorPublicKey = [auditor.publicKey[0], auditor.publicKey[1]];

  // 3) deposit: owner mints 100.00 xUSD to Alice
  console.log("\nGenerating mint proof…");
  const mintCd = await privateMint(xusd(100), alice.publicKey, auditorPublicKey);
  const mintTx = await eerc
    .connect(owner)
    [
      "privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"
    ](alice.signer.address, { proofPoints: mintCd.proofPoints, publicSignals: mintCd.publicSignals });
  await mintTx.wait();
  console.log(`Minted 100.00 xUSD → Alice · ${tx(mintTx.hash)}`);
  console.log(`  Alice balance (decrypted): ${fmt(await decBalance(alice))} xUSD`);

  // 4) pay: Alice privately transfers 30.00 to Bob
  console.log("\nGenerating transfer proof…");
  const aBal = await decBalance(alice);
  const aEnc = await eerc.balanceOfStandalone(alice.signer.address);
  const { proof, senderBalancePCT } = await privateTransfer(
    alice,
    aBal,
    bob.publicKey,
    xusd(30),
    [...aEnc.eGCT.c1, ...aEnc.eGCT.c2],
    auditorPublicKey,
  );
  const payTx = await eerc
    .connect(aliceW as any)
    [
      "transfer(address,uint256,((uint256[2],uint256[2][2],uint256[2]),uint256[32]),uint256[7],bytes)"
    ](bob.signer.address, 0n, proof, senderBalancePCT, "0x");
  await payTx.wait();
  console.log(`Alice → Bob 30.00 xUSD (confidential) · ${tx(payTx.hash)}`);

  console.log("\nFinal decrypted balances:");
  console.log(`  Alice: ${fmt(await decBalance(alice))} xUSD`);
  console.log(`  Bob:   ${fmt(await decBalance(bob))} xUSD`);
  console.log("\n✅ Live deposit + pay-to-a-different-wallet verified on Fuji.\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
