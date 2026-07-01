// XORR bridge test — EVM → Avalanche eERC lock-and-mint, and the reverse.
//
//   Bridge IN:  user locks 50 USDC on the source escrow  → relayer privateMints
//               50 xUSD (confidential) to the recipient on the destination eERC.
//   Bridge OUT: recipient burns 20 xUSD on the eERC       → relayer releases 20
//               USDC back on the source escrow (nullifier-guarded).
//
//   npx hardhat test test/xorr-bridge.ts
import { ethers, zkit } from "hardhat";
import { expect } from "chai";
import {
  deployLibrary,
  deployVerifiers,
  privateMint,
  privateBurn,
  getDecryptedBalance,
} from "./helpers";
import { User } from "./user";
import { EncryptedERC__factory, SimpleERC20__factory, XorrBridge__factory } from "../typechain-types";
import type { RegistrationCircuit } from "../generated-types/zkit";

const units = (n: number) => BigInt(Math.round(n * 100)); // 2 decimals, 1:1 USDC↔xUSD
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);

describe("XorrBridge — EVM→eERC lock-and-mint (+ burn-and-release)", function () {
  this.timeout(600_000);

  it("locks USDC → mints private xUSD, then burns xUSD → releases USDC", async () => {
    const signers = await ethers.getSigners();
    const owner = signers[0]; // deployer / relayer / eERC owner / auditor
    const user = signers[1]; // public EVM user bridging in
    const recipient = new User(signers[2]); // eERC-registered recipient
    const auditor = new User(signers[0]);

    // ── source chain: test USDC + bridge escrow (relayer = owner) ─────────────
    const usdc = await new SimpleERC20__factory(owner).deploy("USD Coin", "USDC", 2);
    await usdc.waitForDeployment();
    const bridge = await new XorrBridge__factory(owner).deploy(usdc.target, owner.address);
    await bridge.waitForDeployment();

    // ── destination chain: standalone eERC (dev verifiers) ────────────────────
    const { registrationVerifier, mintVerifier, withdrawVerifier, transferVerifier, burnVerifier } =
      await deployVerifiers(owner, false);
    const babyJubJub = await deployLibrary(owner);
    const registrar = await (await ethers.getContractFactory("Registrar")).deploy(registrationVerifier);
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
      const cd = await regCircuit.generateCalldata(proof);
      await (await registrar.connect(u.signer).register({ proofPoints: cd.proofPoints, publicSignals: cd.publicSignals })).wait();
    }
    async function decBalance(u: User) {
      const b = await eerc.balanceOfStandalone(u.signer.address);
      return getDecryptedBalance(u.privateKey, b.amountPCTs, b.balancePCT, b.eGCT);
    }

    await register(auditor);
    await register(recipient);
    await (await eerc.connect(owner).setAuditorPublicKey(owner.address)).wait();
    const auditorPublicKey = [auditor.publicKey[0], auditor.publicKey[1]];

    // ── BRIDGE IN: user locks 50 USDC ─────────────────────────────────────────
    await (await usdc.mint(user.address, units(50))).wait();
    await (await usdc.connect(user).approve(bridge.target, units(50))).wait();
    const lockTx = await bridge.connect(user).lock(units(50), recipient.signer.address);
    const rc = await lockTx.wait();

    // relayer reads the Locked event
    const locked = await bridge.queryFilter(bridge.filters.Locked, rc!.blockNumber, rc!.blockNumber);
    expect(locked.length).to.equal(1);
    const { fujiRecipient, amount } = locked[0].args;
    expect(fujiRecipient).to.equal(recipient.signer.address);
    expect(amount).to.equal(units(50));
    expect(await bridge.totalLocked()).to.equal(units(50));
    expect(await usdc.balanceOf(bridge.target)).to.equal(units(50));
    console.log(`    ✓ locked ${fmt(amount)} USDC → escrow (recipient ${fujiRecipient.slice(0, 8)}…)`);

    // relayer privateMints the confidential equivalent on the eERC
    const mintCd = await privateMint(amount, recipient.publicKey, auditorPublicKey);
    await (
      await eerc
        .connect(owner)
        [
          "privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"
        ](recipient.signer.address, { proofPoints: mintCd.proofPoints, publicSignals: mintCd.publicSignals })
    ).wait();
    expect(await decBalance(recipient)).to.equal(units(50));
    console.log(`    ✓ relayer minted ${fmt(units(50))} private xUSD → recipient (bridged in)`);

    // ── BRIDGE OUT: recipient burns 20 xUSD, relayer releases 20 USDC ─────────
    const recBal = await decBalance(recipient);
    const recEnc = await eerc.balanceOfStandalone(recipient.signer.address);
    const { proof, userBalancePCT } = await privateBurn(
      recipient,
      recBal,
      units(20),
      [...recEnc.eGCT.c1, ...recEnc.eGCT.c2],
      auditorPublicKey,
    );
    const burnTx = await eerc
      .connect(recipient.signer)
      [
        "privateBurn(address,((uint256[2],uint256[2][2],uint256[2]),uint256[19]),uint256[7],bytes)"
      ](recipient.signer.address, { proofPoints: proof.proofPoints, publicSignals: proof.publicSignals }, userBalancePCT, "0x");
    await burnTx.wait();
    expect(await decBalance(recipient)).to.equal(units(30));
    console.log(`    ✓ recipient burned ${fmt(units(20))} xUSD on eERC (bridging out)`);

    // relayer releases the USDC back, keyed by the burn tx hash as the nullifier
    const nullifier = burnTx.hash as `0x${string}`;
    await (await bridge.connect(owner).release(user.address, units(20), nullifier)).wait();
    expect(await usdc.balanceOf(user.address)).to.equal(units(20));
    expect(await bridge.totalLocked()).to.equal(units(30));
    console.log(`    ✓ relayer released ${fmt(units(20))} USDC → user (bridged out)`);

    // replay protection
    await expect(
      bridge.connect(owner).release(user.address, units(20), nullifier),
    ).to.be.revertedWithCustomError(bridge, "AlreadyReleased");
    console.log("    ✓ release replay rejected (nullifier spent)");
  });
});
