// ConfidentialPayroll — unit + integration tests. Amounts are hidden behind
// keccak commitments; claims reveal (amount, salt) bound into the claim signature;
// per-slot compliance ciphers are stored opaquely on-chain.
//
//   npx hardhat test test/xorr-confidential-payroll.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import { SimpleERC20__factory, ConfidentialPayroll__factory } from "../typechain-types";
import type { HDNodeWallet } from "ethers";

const usd = (n: number) => BigInt(Math.round(n * 100)); // USDC 2 decimals
const ZERO = "0x0000000000000000000000000000000000000000";
const salt = () => ethers.hexlify(ethers.randomBytes(32));
const cipher = (i: number) => ethers.hexlify(ethers.randomBytes(80 + i)); // opaque compliance blob

async function deploy() {
  const [employer, alice, bob, carol, attacker] = await ethers.getSigners();
  const usdc = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
  const payroll = await new ConfidentialPayroll__factory(employer).deploy();
  await payroll.waitForDeployment();
  await (await usdc.mint(employer.address, usd(1_000_000))).wait();
  await (await usdc.connect(employer).approve(payroll.target, usd(1_000_000))).wait();
  return { employer, alice, bob, carol, attacker, usdc, payroll };
}

async function signClaim(
  payroll: Awaited<ReturnType<typeof deploy>>["payroll"],
  key: HDNodeWallet,
  id: bigint,
  slot: bigint,
  to: string,
  amount: bigint,
  s: string,
): Promise<string> {
  const digest = await payroll.claimDigest(id, slot, to, amount, s);
  return key.signMessage(ethers.getBytes(digest));
}

describe("ConfidentialPayroll — unit + integration", function () {
  describe("createRun()", () => {
    it("reverts on empty batch / length mismatch / zero pool / zero claim addr", async () => {
      const { payroll, usdc } = await deploy();
      const k = ethers.Wallet.createRandom();
      const c = await payroll.amountCommit(usd(10), salt());
      await expect(payroll.createRun(usdc.target, [], [], [], usd(10), ZERO, 0)).to.be.revertedWithCustomError(payroll, "EmptyBatch");
      await expect(
        payroll.createRun(usdc.target, [k.address], [c, c], [cipher(0)], usd(10), ZERO, 0),
      ).to.be.revertedWithCustomError(payroll, "LengthMismatch");
      await expect(
        payroll.createRun(usdc.target, [k.address], [c], [cipher(0)], 0, ZERO, 0),
      ).to.be.revertedWithCustomError(payroll, "ZeroPool");
      await expect(
        payroll.createRun(usdc.target, [ZERO], [c], [cipher(0)], usd(10), ZERO, 0),
      ).to.be.revertedWithCustomError(payroll, "ZeroClaimAddr");
    });

    it("pulls the pool, stores commitments + compliance ciphers, emits RunCreated", async () => {
      const { payroll, usdc, employer, attacker } = await deploy();
      const keys = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];
      const salts = [salt(), salt()];
      const amounts = [usd(2500), usd(1800)];
      const commits = await Promise.all(amounts.map((a, i) => payroll.amountCommit(a, salts[i])));
      const ciphers = [cipher(0), cipher(1)];
      const pool = amounts.reduce((a, b) => a + b, 0n);
      const auditor = attacker.address; // stand-in compliance key holder address

      await expect(
        payroll.createRun(usdc.target, keys.map((k) => k.address), commits, ciphers, pool, auditor, 0),
      )
        .to.emit(payroll, "RunCreated")
        .withArgs(0n, employer.address, usdc.target, 2n, pool, auditor, 0n);

      expect(await payroll.runCount()).to.equal(1n);
      expect(await payroll.slotCount(0)).to.equal(2n);
      expect(await usdc.balanceOf(payroll.target)).to.equal(pool);

      const run = await payroll.getRun(0);
      expect(run.employer).to.equal(employer.address);
      expect(run.pool).to.equal(pool);
      expect(run.auditor).to.equal(auditor);

      const s0 = await payroll.getSlot(0, 0);
      expect(s0.claimAddr).to.equal(keys[0].address);
      expect(s0.amountCommit).to.equal(commits[0]);
      expect(s0.claimed).to.equal(false);
      // the amount itself is NOT stored — only the commitment
      expect(await payroll.auditorCipher(0, 1)).to.equal(ciphers[1]);
    });
  });

  describe("claim()", () => {
    async function oneSlot(amount = usd(100)) {
      const f = await deploy();
      const key = ethers.Wallet.createRandom();
      const s = salt();
      const commit = await f.payroll.amountCommit(amount, s);
      await (await f.payroll.createRun(f.usdc.target, [key.address], [commit], [cipher(0)], amount, ZERO, 0)).wait();
      return { ...f, key, s, amount };
    }

    it("pays the revealed amount when the commit + signature match", async () => {
      const { payroll, usdc, alice, key, s, amount } = await oneSlot(usd(250));
      const sig = await signClaim(payroll, key, 0n, 0n, alice.address, amount, s);
      await expect(payroll.connect(alice).claim(0, 0, alice.address, amount, s, sig))
        .to.emit(payroll, "Claimed")
        .withArgs(0n, 0n, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.equal(usd(250));
      expect((await payroll.getSlot(0, 0)).claimed).to.equal(true);
      expect((await payroll.getRun(0)).disbursed).to.equal(usd(250));
    });

    it("reverts ZeroTo when claiming to the zero address", async () => {
      const { payroll, key, s, amount } = await oneSlot(usd(100));
      const sig = await signClaim(payroll, key, 0n, 0n, ZERO, amount, s);
      await expect(
        payroll.claim(0, 0, ZERO, amount, s, sig),
      ).to.be.revertedWithCustomError(payroll, "ZeroTo");
    });

    it("reverts BadCommit if the revealed amount/salt doesn't match", async () => {
      const { payroll, alice, key, s, amount } = await oneSlot(usd(100));
      // sign a lie (200) — but commit is for 100 → BadCommit before sig check
      const sig = await signClaim(payroll, key, 0n, 0n, alice.address, usd(200), s);
      await expect(
        payroll.connect(alice).claim(0, 0, alice.address, usd(200), s, sig),
      ).to.be.revertedWithCustomError(payroll, "BadCommit");
    });

    it("front-run resistant: can't redirect a claim to another address", async () => {
      const { payroll, alice, attacker, key, s, amount } = await oneSlot(usd(100));
      const sig = await signClaim(payroll, key, 0n, 0n, alice.address, amount, s);
      await expect(
        payroll.connect(attacker).claim(0, 0, attacker.address, amount, s, sig),
      ).to.be.revertedWithCustomError(payroll, "BadSignature");
    });

    it("reverts BadSignature when a different key signs", async () => {
      const { payroll, alice, s, amount } = await oneSlot(usd(100));
      const wrong = ethers.Wallet.createRandom();
      const sig = await signClaim(payroll, wrong, 0n, 0n, alice.address, amount, s);
      await expect(
        payroll.connect(alice).claim(0, 0, alice.address, amount, s, sig),
      ).to.be.revertedWithCustomError(payroll, "BadSignature");
    });

    it("reverts AlreadyClaimed on a second claim", async () => {
      const { payroll, alice, key, s, amount } = await oneSlot(usd(100));
      const sig = await signClaim(payroll, key, 0n, 0n, alice.address, amount, s);
      await (await payroll.connect(alice).claim(0, 0, alice.address, amount, s, sig)).wait();
      await expect(
        payroll.connect(alice).claim(0, 0, alice.address, amount, s, sig),
      ).to.be.revertedWithCustomError(payroll, "AlreadyClaimed");
    });

    it("reverts PoolExceeded if a claim would draw more than the funded pool", async () => {
      // pool funded at 100 but the slot commits 200 → claim exceeds collateral
      const f = await deploy();
      const key = ethers.Wallet.createRandom();
      const s = salt();
      const commit = await f.payroll.amountCommit(usd(200), s);
      await (await f.payroll.createRun(f.usdc.target, [key.address], [commit], [cipher(0)], usd(100), ZERO, 0)).wait();
      const sig = await signClaim(f.payroll, key, 0n, 0n, f.alice.address, usd(200), s);
      await expect(
        f.payroll.connect(f.alice).claim(0, 0, f.alice.address, usd(200), s, sig),
      ).to.be.revertedWithCustomError(f.payroll, "PoolExceeded");
    });
  });

  describe("sweep()", () => {
    async function withExpiry(secs: number) {
      const f = await deploy();
      const key = ethers.Wallet.createRandom();
      const s = salt();
      const commit = await f.payroll.amountCommit(usd(100), s);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await (
        await f.payroll.createRun(f.usdc.target, [key.address], [commit], [cipher(0)], usd(100), ZERO, BigInt(now + secs))
      ).wait();
      return { ...f, key, s };
    }

    it("reverts NotEmployer / NoExpiry / NotExpired appropriately", async () => {
      const { payroll, usdc, employer, attacker } = await deploy();
      const key = ethers.Wallet.createRandom();
      const s = salt();
      const commit = await payroll.amountCommit(usd(100), s);
      await (await payroll.createRun(usdc.target, [key.address], [commit], [cipher(0)], usd(100), ZERO, 0)).wait();
      await expect(payroll.connect(attacker).sweep(0)).to.be.revertedWithCustomError(payroll, "NotEmployer");
      await expect(payroll.connect(employer).sweep(0)).to.be.revertedWithCustomError(payroll, "NoExpiry");

      const f2 = await withExpiry(3600); // fresh contract → its run is id 0
      await expect(f2.payroll.connect(f2.employer).sweep(0)).to.be.revertedWithCustomError(f2.payroll, "NotExpired");
    });

    it("returns unclaimed collateral to the employer after expiry", async () => {
      const { payroll, usdc, employer } = await withExpiry(60);
      const before = await usdc.balanceOf(employer.address);
      await ethers.provider.send("evm_increaseTime", [120]);
      await ethers.provider.send("evm_mine", []);
      await expect(payroll.connect(employer).sweep(0)).to.emit(payroll, "Swept").withArgs(0n, employer.address, usd(100));
      expect(await usdc.balanceOf(employer.address)).to.equal(before + usd(100));
      // after sweep the pool is fully accounted → no more claims possible
      expect((await payroll.getRun(0)).disbursed).to.equal(usd(100));
    });
  });

  describe("integration — a full confidential run with compliance", () => {
    it("hides amounts on-chain, each recipient claims their own, auditor cipher preserved", async () => {
      const [employer, aliceW, bobW, carolW, relayer] = await ethers.getSigners();
      const usdc = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
      const payroll = await new ConfidentialPayroll__factory(employer).deploy();
      await payroll.waitForDeployment();
      await (await usdc.mint(employer.address, usd(10_000))).wait();

      const roster = [
        { amount: usd(2500), wallet: aliceW },
        { amount: usd(1800), wallet: bobW },
        { amount: usd(3200), wallet: carolW },
      ];
      const keys = roster.map(() => ethers.Wallet.createRandom());
      const salts = roster.map(() => salt());
      const commits = await Promise.all(roster.map((r, i) => payroll.amountCommit(r.amount, salts[i])));
      const ciphers = roster.map((_, i) => cipher(i)); // opaque compliance blobs (crypto JS-tested separately)
      const pool = roster.reduce((a, r) => a + r.amount, 0n);

      await (await usdc.connect(employer).approve(payroll.target, pool)).wait();
      await (
        await payroll.createRun(usdc.target, keys.map((k) => k.address), commits, ciphers, pool, employer.address, 0)
      ).wait();

      // on-chain, nobody can see the individual amounts — only commitments
      for (let i = 0; i < roster.length; i++) {
        const slot = await payroll.getSlot(0, i);
        expect(slot.amountCommit).to.equal(commits[i]);
        expect(await payroll.auditorCipher(0, i)).to.equal(ciphers[i]); // compliance record retained
      }

      // each recipient reveals ONLY their own (amount, salt) to claim
      for (let i = 0; i < roster.length; i++) {
        const { wallet, amount } = roster[i];
        const sig = await signClaim(payroll, keys[i], 0n, BigInt(i), wallet.address, amount, salts[i]);
        await (await payroll.connect(relayer).claim(0, i, wallet.address, amount, salts[i], sig)).wait();
        expect(await usdc.balanceOf(wallet.address)).to.equal(amount);
      }

      expect((await payroll.getRun(0)).disbursed).to.equal(pool);
      expect(await usdc.balanceOf(payroll.target)).to.equal(0n);
    });
  });
});
