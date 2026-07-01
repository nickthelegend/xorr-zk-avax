// XORR end-to-end flow test (standalone eERC): the "deposit and pay to a
// different guy" scenario, plus withdraw + auditor.
//
//   Alice registers, Bob registers, owner sets an auditor.
//   Owner privateMints 100.00 xUSD to Alice   → Alice decrypts 100.00
//   Alice privateTransfers 30.00 to Bob        → Bob decrypts 30.00, Alice 70.00
//   Bob withdraws (burns) 10.00                → Bob decrypts 20.00
//
// Runs on the local Hardhat network with the locally-built (dev) circuits, so
// it needs no gas and proves the real zk flow deterministically.
//   npx hardhat test test/xorr-flow.ts
import { ethers, zkit } from "hardhat";
import { expect } from "chai";
import {
  deployLibrary,
  deployVerifiers,
  privateMint,
  privateTransfer,
  privateBurn,
  getDecryptedBalance,
} from "./helpers";
import { User } from "./user";
import { EncryptedERC__factory } from "../typechain-types";
import type { RegistrationCircuit } from "../generated-types/zkit";

const SCALE = 100n; // DECIMALS = 2 → 1.00 xUSD = 100 base units
const xusd = (n: number) => BigInt(Math.round(n * 100));

describe("XORR flow — mint → pay Alice→Bob → withdraw (standalone eERC)", function () {
  this.timeout(600_000); // proof generation is heavy

  it("mints to Alice, privately pays Bob, and withdraws", async () => {
    const signers = await ethers.getSigners();
    const owner = signers[0];
    const alice = new User(signers[1]);
    const bob = new User(signers[2]);
    const auditor = new User(signers[0]); // owner doubles as the auditor

    // ── deploy (dev verifiers match the locally-built zkeys) ──────────────────
    const { registrationVerifier, mintVerifier, withdrawVerifier, transferVerifier, burnVerifier } =
      await deployVerifiers(owner, false);
    const babyJubJub = await deployLibrary(owner);
    const registrar = await (
      await ethers.getContractFactory("Registrar")
    ).deploy(registrationVerifier);
    await registrar.waitForDeployment();

    const eerc = await new EncryptedERC__factory({
      "contracts/libraries/BabyJubJub.sol:BabyJubJub": babyJubJub,
    })
      .connect(owner)
      .deploy({
        registrar: registrar.target,
        isConverter: false,
        name: "XORR Private USD",
        symbol: "xUSD",
        mintVerifier,
        withdrawVerifier,
        transferVerifier,
        burnVerifier,
        decimals: 2,
      });
    await eerc.waitForDeployment();

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const regCircuit = (await zkit.getCircuit("RegistrationCircuit")) as unknown as RegistrationCircuit;

    async function register(u: User) {
      const input = {
        SenderPrivateKey: u.formattedPrivateKey,
        SenderPublicKey: u.publicKey,
        SenderAddress: BigInt(u.signer.address),
        ChainID: chainId,
        RegistrationHash: u.genRegistrationHash(chainId),
      };
      const proof = await regCircuit.generateProof(input);
      const calldata = await regCircuit.generateCalldata(proof);
      await (
        await registrar.connect(u.signer).register({
          proofPoints: calldata.proofPoints,
          publicSignals: calldata.publicSignals,
        })
      ).wait();
      expect(await registrar.isUserRegistered(u.signer.address)).to.be.true;
    }

    async function balanceOf(u: User) {
      const b = await eerc.balanceOfStandalone(u.signer.address);
      return getDecryptedBalance(u.privateKey, b.amountPCTs, b.balancePCT, b.eGCT);
    }

    // ── register + auditor ────────────────────────────────────────────────────
    await register(auditor); // owner/auditor
    await register(alice);
    await register(bob);

    await (await eerc.connect(owner).setAuditorPublicKey(owner.address)).wait();
    expect(await eerc.isAuditorKeySet()).to.be.true;
    const auditorPublicKey = [auditor.publicKey[0], auditor.publicKey[1]];

    // ── deposit: owner mints 100.00 xUSD to Alice ─────────────────────────────
    const mintCalldata = await privateMint(xusd(100), alice.publicKey, auditorPublicKey);
    await (
      await eerc
        .connect(owner)
        [
          "privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"
        ](alice.signer.address, {
          proofPoints: mintCalldata.proofPoints,
          publicSignals: mintCalldata.publicSignals,
        })
    ).wait();

    expect(await balanceOf(alice)).to.equal(xusd(100));
    expect(await balanceOf(bob)).to.equal(0n);
    console.log("    ✓ minted 100.00 xUSD → Alice");

    // ── pay: Alice privately transfers 30.00 to Bob ───────────────────────────
    const aliceBal = await balanceOf(alice);
    const aliceEnc = await eerc.balanceOfStandalone(alice.signer.address);
    const { proof: tProof, senderBalancePCT } = await privateTransfer(
      alice,
      aliceBal,
      bob.publicKey,
      xusd(30),
      [...aliceEnc.eGCT.c1, ...aliceEnc.eGCT.c2],
      auditorPublicKey
    );
    await (
      await eerc
        .connect(alice.signer)
        [
          "transfer(address,uint256,((uint256[2],uint256[2][2],uint256[2]),uint256[32]),uint256[7],bytes)"
        ](bob.signer.address, 0n, tProof, senderBalancePCT, "0x")
    ).wait();

    expect(await balanceOf(bob)).to.equal(xusd(30));
    expect(await balanceOf(alice)).to.equal(xusd(70));
    console.log("    ✓ Alice paid Bob 30.00 xUSD privately (Bob=30.00, Alice=70.00)");

    // ── withdraw: Bob privately burns 10.00 back out (standalone unshield) ─────
    const bobBal = await balanceOf(bob);
    const bobEnc = await eerc.balanceOfStandalone(bob.signer.address);
    const { proof: bProof, userBalancePCT } = await privateBurn(
      bob,
      bobBal,
      xusd(10),
      [...bobEnc.eGCT.c1, ...bobEnc.eGCT.c2],
      auditorPublicKey
    );
    await (
      await eerc
        .connect(bob.signer)
        [
          "privateBurn(address,((uint256[2],uint256[2][2],uint256[2]),uint256[19]),uint256[7],bytes)"
        ](bob.signer.address, {
          proofPoints: bProof.proofPoints,
          publicSignals: bProof.publicSignals,
        }, userBalancePCT, "0x")
    ).wait();

    expect(await balanceOf(bob)).to.equal(xusd(20));
    console.log("    ✓ Bob withdrew (burned) 10.00 xUSD (Bob=20.00)");
  });
});
