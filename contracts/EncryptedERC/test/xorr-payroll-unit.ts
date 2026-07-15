// PayrollEscrow unit tests — batch funding, claim-key signature verification,
// front-run resistance, reclaim, and accounting. Pure-Solidity behaviour, no ZK.
//
//   npx hardhat test test/xorr-payroll-unit.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import { SimpleERC20__factory, PayrollEscrow__factory } from "../typechain-types";
import type { HDNodeWallet } from "ethers";

const units = (n: number) => BigInt(Math.round(n * 100)); // USDC = 2 decimals
const ZERO = "0x0000000000000000000000000000000000000000";

// Sign the on-chain claim digest with a throwaway claim key (EIP-191 personal_sign
// over the 32 raw bytes — matches MessageHashUtils.toEthSignedMessageHash + ECDSA.recover).
async function signClaim(
  payroll: Awaited<ReturnType<typeof deploy>>["payroll"],
  key: HDNodeWallet,
  id: bigint,
  slot: bigint,
  to: string,
): Promise<string> {
  const digest = await payroll.claimDigest(id, slot, to);
  return key.signMessage(ethers.getBytes(digest));
}

async function deploy() {
  const [employer, alice, bob, carol, attacker] = await ethers.getSigners();
  const usdc = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
  const payroll = await new PayrollEscrow__factory(employer).deploy();
  await payroll.waitForDeployment();
  await (await usdc.mint(employer.address, units(1_000_000))).wait();
  await (await usdc.connect(employer).approve(payroll.target, units(1_000_000))).wait();
  return { employer, alice, bob, carol, attacker, usdc, payroll };
}

// three fresh "emailed" claim keys
const claimKeys = () => [
  ethers.Wallet.createRandom(),
  ethers.Wallet.createRandom(),
  ethers.Wallet.createRandom(),
];

describe("PayrollEscrow — unit tests", function () {
  describe("createPayroll()", () => {
    it("reverts EmptyBatch for an empty batch", async () => {
      const { payroll, usdc } = await deploy();
      await expect(payroll.createPayroll(usdc.target, [], [], 0)).to.be.revertedWithCustomError(
        payroll,
        "EmptyBatch",
      );
    });

    it("reverts LengthMismatch when arrays differ", async () => {
      const { payroll, usdc } = await deploy();
      const [k] = claimKeys();
      await expect(
        payroll.createPayroll(usdc.target, [k.address], [units(1), units(2)], 0),
      ).to.be.revertedWithCustomError(payroll, "LengthMismatch");
    });

    it("reverts ZeroAmount for a zero-amount slot", async () => {
      const { payroll, usdc } = await deploy();
      const [k] = claimKeys();
      await expect(
        payroll.createPayroll(usdc.target, [k.address], [0n], 0),
      ).to.be.revertedWithCustomError(payroll, "ZeroAmount");
    });

    it("reverts ZeroClaimAddr for a zero claim address", async () => {
      const { payroll, usdc } = await deploy();
      await expect(
        payroll.createPayroll(usdc.target, [ZERO], [units(1)], 0),
      ).to.be.revertedWithCustomError(payroll, "ZeroClaimAddr");
    });

    it("reverts if the employer has not approved enough USDC", async () => {
      const { payroll, employer } = await deploy();
      const usdc2 = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
      await (await usdc2.mint(employer.address, units(10))).wait(); // no approve
      const [k] = claimKeys();
      await expect(payroll.createPayroll(usdc2.target, [k.address], [units(10)], 0)).to.be.reverted;
    });

    it("pulls the total, stores slots, and emits PayrollCreated", async () => {
      const { payroll, usdc, employer } = await deploy();
      const keys = claimKeys();
      const amounts = [units(100), units(250), units(50)];
      const total = amounts.reduce((a, b) => a + b, 0n);

      await expect(
        payroll.createPayroll(usdc.target, keys.map((k) => k.address), amounts, 0),
      )
        .to.emit(payroll, "PayrollCreated")
        .withArgs(0n, employer.address, usdc.target, 3n, total, 0n);

      expect(await payroll.payrollCount()).to.equal(1n);
      expect(await payroll.slotCount(0)).to.equal(3n);
      expect(await usdc.balanceOf(payroll.target)).to.equal(total);

      const p = await payroll.getPayroll(0);
      expect(p.employer).to.equal(employer.address);
      expect(p.unclaimed).to.equal(total);

      const s1 = await payroll.getSlot(0, 1);
      expect(s1.claimAddr).to.equal(keys[1].address);
      expect(s1.amount).to.equal(units(250));
      expect(s1.claimed).to.equal(false);
    });

    it("assigns sequential ids across batches", async () => {
      const { payroll, usdc } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(1)], 0)).wait();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(2)], 0)).wait();
      expect(await payroll.payrollCount()).to.equal(2n);
    });
  });

  describe("claim()", () => {
    it("releases funds to the recipient when the claim key signs their address", async () => {
      const { payroll, usdc, alice } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();

      const sig = await signClaim(payroll, k, 0n, 0n, alice.address);
      await expect(payroll.connect(alice).claim(0, 0, alice.address, sig))
        .to.emit(payroll, "Claimed")
        .withArgs(0n, 0n, alice.address, units(100));

      expect(await usdc.balanceOf(alice.address)).to.equal(units(100));
      expect((await payroll.getSlot(0, 0)).claimed).to.equal(true);
      expect((await payroll.getPayroll(0)).unclaimed).to.equal(0n);
      expect(await usdc.balanceOf(payroll.target)).to.equal(0n);
    });

    it("lets anyone submit the tx — the payout still goes to the signed address", async () => {
      const { payroll, usdc, alice, attacker } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();

      // signature commits to alice; the attacker relays the tx but funds go to alice.
      const sig = await signClaim(payroll, k, 0n, 0n, alice.address);
      await (await payroll.connect(attacker).claim(0, 0, alice.address, sig)).wait();
      expect(await usdc.balanceOf(alice.address)).to.equal(units(100));
      expect(await usdc.balanceOf(attacker.address)).to.equal(0n);
    });

    it("front-run resistant: a stolen signature can't be redirected to another address", async () => {
      const { payroll, usdc, alice, attacker } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();

      // signature is over alice; attacker replays it with their own `to` → digest changes,
      // recovered signer != claimAddr → BadSignature.
      const sig = await signClaim(payroll, k, 0n, 0n, alice.address);
      await expect(
        payroll.connect(attacker).claim(0, 0, attacker.address, sig),
      ).to.be.revertedWithCustomError(payroll, "BadSignature");
    });

    it("reverts BadSignature when a different key signs", async () => {
      const { payroll, usdc, alice } = await deploy();
      const [k] = claimKeys();
      const wrong = ethers.Wallet.createRandom();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();
      const sig = await signClaim(payroll, wrong, 0n, 0n, alice.address);
      await expect(
        payroll.connect(alice).claim(0, 0, alice.address, sig),
      ).to.be.revertedWithCustomError(payroll, "BadSignature");
    });

    it("reverts AlreadyClaimed on a second claim", async () => {
      const { payroll, usdc, alice } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();
      const sig = await signClaim(payroll, k, 0n, 0n, alice.address);
      await (await payroll.connect(alice).claim(0, 0, alice.address, sig)).wait();
      await expect(
        payroll.connect(alice).claim(0, 0, alice.address, sig),
      ).to.be.revertedWithCustomError(payroll, "AlreadyClaimed");
    });

    it("reverts ZeroTo when claiming to the zero address", async () => {
      const { payroll, usdc } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();
      await expect(payroll.claim(0, 0, ZERO, "0x")).to.be.revertedWithCustomError(payroll, "ZeroTo");
    });

    it("reverts BadId / BadSlot for out-of-range indices", async () => {
      const { payroll, usdc, alice } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();
      const sig = await signClaim(payroll, k, 0n, 0n, alice.address);
      await expect(payroll.claim(9, 0, alice.address, sig)).to.be.revertedWithCustomError(
        payroll,
        "BadId",
      );
      await expect(payroll.claim(0, 9, alice.address, sig)).to.be.revertedWithCustomError(
        payroll,
        "BadSlot",
      );
    });

    it("a signature for one slot can't be reused on another slot", async () => {
      const { payroll, usdc, alice } = await deploy();
      const [k0, k1] = claimKeys();
      await (
        await payroll.createPayroll(
          usdc.target,
          [k0.address, k1.address],
          [units(100), units(100)],
          0,
        )
      ).wait();
      // sig authorises slot 0 → replaying on slot 1 changes the digest → BadSignature
      const sig = await signClaim(payroll, k0, 0n, 0n, alice.address);
      await expect(
        payroll.connect(alice).claim(0, 1, alice.address, sig),
      ).to.be.revertedWithCustomError(payroll, "BadSignature");
    });
  });

  describe("reclaim()", () => {
    it("reverts NotEmployer for a non-employer", async () => {
      const { payroll, usdc, attacker } = await deploy();
      const [k] = claimKeys();
      await (
        await payroll.createPayroll(usdc.target, [k.address], [units(100)], 1n)
      ).wait();
      await expect(payroll.connect(attacker).reclaim(0, 0)).to.be.revertedWithCustomError(
        payroll,
        "NotEmployer",
      );
    });

    it("reverts NoExpiry when the batch was created permanent (expiry 0)", async () => {
      const { payroll, usdc, employer } = await deploy();
      const [k] = claimKeys();
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], 0)).wait();
      await expect(payroll.connect(employer).reclaim(0, 0)).to.be.revertedWithCustomError(
        payroll,
        "NoExpiry",
      );
    });

    it("reverts NotExpired before the expiry timestamp", async () => {
      const { payroll, usdc, employer } = await deploy();
      const [k] = claimKeys();
      const future = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], future)).wait();
      await expect(payroll.connect(employer).reclaim(0, 0)).to.be.revertedWithCustomError(
        payroll,
        "NotExpired",
      );
    });

    it("returns unclaimed funds to the employer after expiry", async () => {
      const { payroll, usdc, employer } = await deploy();
      const [k] = claimKeys();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], BigInt(now + 60))).wait();
      const before = await usdc.balanceOf(employer.address);

      await ethers.provider.send("evm_increaseTime", [120]);
      await ethers.provider.send("evm_mine", []);

      await expect(payroll.connect(employer).reclaim(0, 0))
        .to.emit(payroll, "Reclaimed")
        .withArgs(0n, 0n, employer.address, units(100));
      expect(await usdc.balanceOf(employer.address)).to.equal(before + units(100));
      expect((await payroll.getPayroll(0)).unclaimed).to.equal(0n);
    });

    it("cannot reclaim a slot that was already claimed", async () => {
      const { payroll, usdc, employer, alice } = await deploy();
      const [k] = claimKeys();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await (await payroll.createPayroll(usdc.target, [k.address], [units(100)], BigInt(now + 60))).wait();
      const sig = await signClaim(payroll, k, 0n, 0n, alice.address);
      await (await payroll.connect(alice).claim(0, 0, alice.address, sig)).wait();

      await ethers.provider.send("evm_increaseTime", [120]);
      await ethers.provider.send("evm_mine", []);
      await expect(payroll.connect(employer).reclaim(0, 0)).to.be.revertedWithCustomError(
        payroll,
        "AlreadyClaimed",
      );
    });
  });

  describe("accounting across a partially-claimed batch", () => {
    it("tracks unclaimed and conserves the contract balance", async () => {
      const { payroll, usdc, alice, bob } = await deploy();
      const [k0, k1, k2] = claimKeys();
      const amounts = [units(100), units(200), units(300)];
      const total = amounts.reduce((a, b) => a + b, 0n);
      await (
        await payroll.createPayroll(usdc.target, [k0.address, k1.address, k2.address], amounts, 0)
      ).wait();

      // claim slots 0 and 2, leave slot 1 unclaimed
      await (
        await payroll
          .connect(alice)
          .claim(0, 0, alice.address, await signClaim(payroll, k0, 0n, 0n, alice.address))
      ).wait();
      await (
        await payroll
          .connect(bob)
          .claim(0, 2, bob.address, await signClaim(payroll, k2, 0n, 2n, bob.address))
      ).wait();

      expect(await usdc.balanceOf(alice.address)).to.equal(units(100));
      expect(await usdc.balanceOf(bob.address)).to.equal(units(300));
      expect((await payroll.getPayroll(0)).unclaimed).to.equal(units(200));
      expect(await usdc.balanceOf(payroll.target)).to.equal(units(200)); // exactly slot 1 remains
    });
  });
});
