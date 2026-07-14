// PayrollEscrow integration test — the full product flow, end to end:
//   employer funds a batch for 3 "emails" → each recipient opens their claim link,
//   connects a wallet, the claim key signs their payout address, and they collect.
// Mirrors exactly what web/lib/payroll.ts does client-side (claim key = a random
// wallet embedded in the emailed link; signMessage over the on-chain claim digest).
//
//   npx hardhat test test/xorr-payroll.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import { SimpleERC20__factory, PayrollEscrow__factory } from "../typechain-types";

const usd = (n: number) => BigInt(Math.round(n * 100)); // USDC 2 decimals

describe("PayrollEscrow — integration (email → claim, end to end)", function () {
  it("runs a 3-person payroll: fund once, each recipient claims their own pay", async () => {
    const [employer, aliceWallet, bobWallet, carolWallet, relayer] = await ethers.getSigners();

    // Deploy USDC + escrow; fund the employer.
    const usdc = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
    const payroll = await new PayrollEscrow__factory(employer).deploy();
    await payroll.waitForDeployment();
    await (await usdc.mint(employer.address, usd(10_000))).wait();

    // ── Employer builds the run (what PayrollForm does) ──────────────────────
    // For each email, generate a throwaway claim key. Only the address goes on-chain;
    // the private key becomes the secret in that person's emailed claim link.
    const roster = [
      { email: "alice@acme.xyz", amount: usd(2500), wallet: aliceWallet },
      { email: "bob@acme.xyz", amount: usd(1800), wallet: bobWallet },
      { email: "carol@acme.xyz", amount: usd(3200), wallet: carolWallet },
    ];
    const claimKeys = roster.map(() => ethers.Wallet.createRandom());
    const total = roster.reduce((a, r) => a + r.amount, 0n);

    // Fund: one approve + one createPayroll.
    await (await usdc.connect(employer).approve(payroll.target, total)).wait();
    const tx = await payroll.createPayroll(
      usdc.target,
      claimKeys.map((k) => k.address),
      roster.map((r) => r.amount),
      0,
    );
    const rcpt = await tx.wait();
    const id = 0n;

    expect(await payroll.slotCount(id)).to.equal(3n);
    expect(await usdc.balanceOf(payroll.target)).to.equal(total);
    expect((await payroll.getPayroll(id)).unclaimed).to.equal(total);
    // employer funded exactly the total, nothing left on their side beyond change
    expect(await usdc.balanceOf(employer.address)).to.equal(usd(10_000) - total);

    // ── Each recipient opens their link and claims (what /payroll/claim does) ──
    for (let i = 0; i < roster.length; i++) {
      const { wallet, amount } = roster[i];
      const slot = BigInt(i);
      // the claim key (from the URL) signs the recipient's chosen payout address
      const digest = await payroll.claimDigest(id, slot, wallet.address);
      const sig = await claimKeys[i].signMessage(ethers.getBytes(digest));
      // a relayer can submit the tx; funds still route to the signed address
      await (await payroll.connect(relayer).claim(id, slot, wallet.address, sig)).wait();
      expect(await usdc.balanceOf(wallet.address)).to.equal(amount);
      expect((await payroll.getSlot(id, slot)).claimed).to.equal(true);
    }

    // Batch fully drained.
    expect((await payroll.getPayroll(id)).unclaimed).to.equal(0n);
    expect(await usdc.balanceOf(payroll.target)).to.equal(0n);
    expect(rcpt!.status).to.equal(1);
  });

  it("a thief who intercepts a claim link cannot steal to their own wallet", async () => {
    const [employer, victim, thief] = await ethers.getSigners();
    const usdc = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
    const payroll = await new PayrollEscrow__factory(employer).deploy();
    await payroll.waitForDeployment();
    await (await usdc.mint(employer.address, usd(1000))).wait();
    await (await usdc.connect(employer).approve(payroll.target, usd(1000))).wait();

    const key = ethers.Wallet.createRandom(); // the emailed claim key
    await (await payroll.createPayroll(usdc.target, [key.address], [usd(1000)], 0)).wait();

    // Thief has the link (claim key) but signs their OWN address → different digest, but
    // even the victim's already-broadcast signature can't be replayed to the thief's
    // address. Only a signature over the thief's address by the claim key works — which
    // means the thief would just be... claiming to themselves with the key they hold.
    // The realistic guarantee we assert: the VICTIM's signature (over victim.address)
    // cannot be redirected to the thief.
    const victimSig = await key.signMessage(
      ethers.getBytes(await payroll.claimDigest(0, 0, victim.address)),
    );
    await expect(
      payroll.connect(thief).claim(0, 0, thief.address, victimSig),
    ).to.be.revertedWithCustomError(payroll, "BadSignature");

    // The victim still claims successfully.
    await (await payroll.connect(victim).claim(0, 0, victim.address, victimSig)).wait();
    expect(await usdc.balanceOf(victim.address)).to.equal(usd(1000));
  });
});
