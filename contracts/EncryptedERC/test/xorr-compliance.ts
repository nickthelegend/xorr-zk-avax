// ComplianceRegistry — signed on-chain attestation of a verified confidential-payroll run,
// plus a full generation→attestation→verification integration that checks each amount
// against its on-chain commitment (the auditor cannot be fed fake amounts).
//
//   npx hardhat test test/xorr-compliance.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import {
  SimpleERC20__factory,
  ConfidentialPayroll__factory,
  ComplianceRegistry__factory,
} from "../typechain-types";

const usd = (n: number) => BigInt(Math.round(n * 100));
const salt = () => ethers.hexlify(ethers.randomBytes(32));
const abi = ethers.AbiCoder.defaultAbiCoder();

// The canonical report hash the frontend also computes: binds every verified (slot, amount,
// salt, commit) plus the run identity + total.
function computeReportHash(
  payroll: string,
  runId: bigint,
  chainId: bigint,
  slots: { slot: bigint; amount: bigint; salt: string; commit: string }[],
  total: bigint,
): string {
  const encoded = abi.encode(
    ["address", "uint256", "uint256", "tuple(uint256 slot,uint128 amount,bytes32 salt,bytes32 commit)[]", "uint128"],
    [payroll, runId, chainId, slots.map((s) => [s.slot, s.amount, s.salt, s.commit]), total],
  );
  return ethers.keccak256(encoded);
}

describe("ComplianceRegistry — attest + verify", function () {
  async function deploy() {
    const [employer, alice, bob, relayer] = await ethers.getSigners();
    const usdc = await new SimpleERC20__factory(employer).deploy("USD Coin", "USDC", 2);
    const payroll = await new ConfidentialPayroll__factory(employer).deploy();
    const registry = await new ComplianceRegistry__factory(employer).deploy();
    await Promise.all([payroll.waitForDeployment(), registry.waitForDeployment()]);
    await (await usdc.mint(employer.address, usd(100000))).wait();
    await (await usdc.connect(employer).approve(payroll.target, usd(100000))).wait();
    // the compliance officer's key — its EVM address is stored as the run's auditor
    const auditor = ethers.Wallet.createRandom();
    return { employer, alice, bob, relayer, usdc, payroll, registry, auditor };
  }

  async function fundRun(f: Awaited<ReturnType<typeof deploy>>) {
    const roster = [usd(2500), usd(1800)];
    const salts = [salt(), salt()];
    const commits = await Promise.all(roster.map((a, i) => f.payroll.amountCommit(a, salts[i])));
    const keys = roster.map(() => ethers.Wallet.createRandom());
    const ciphers = roster.map((_, i) => ethers.hexlify(ethers.randomBytes(80 + i)));
    const pool = roster.reduce((a, b) => a + b, 0n);
    await (
      await f.payroll.createRun(
        f.usdc.target, keys.map((k) => k.address), commits, ciphers, pool, f.auditor.address, 0,
      )
    ).wait();
    return { roster, salts, commits, pool, runId: 0n };
  }

  it("attest() stores an attestation when the auditor's signature is valid", async () => {
    const f = await deploy();
    const { runId, pool } = await fundRun(f);
    const reportHash = ethers.keccak256("0xdeadbeef");
    const digest = await f.registry.attestationDigest(f.payroll.target, runId, reportHash, pool, f.auditor.address);
    const sig = await f.auditor.signMessage(ethers.getBytes(digest));

    await expect(
      f.registry.connect(f.relayer).attest(f.payroll.target, runId, reportHash, pool, f.auditor.address, sig),
    )
      .to.emit(f.registry, "Attested")
      .withArgs(f.payroll.target, runId, f.auditor.address, reportHash, pool);

    expect(await f.registry.isAttested(f.payroll.target, runId)).to.equal(true);
    const a = await f.registry.getAttestation(f.payroll.target, runId);
    expect(a.auditor).to.equal(f.auditor.address);
    expect(a.reportHash).to.equal(reportHash);
    expect(a.verifiedTotal).to.equal(pool);
    expect(a.timestamp).to.be.greaterThan(0n);
  });

  it("reverts BadSignature if someone else signs", async () => {
    const f = await deploy();
    const { runId, pool } = await fundRun(f);
    const reportHash = ethers.keccak256("0x1234");
    const impostor = ethers.Wallet.createRandom();
    const digest = await f.registry.attestationDigest(f.payroll.target, runId, reportHash, pool, f.auditor.address);
    const sig = await impostor.signMessage(ethers.getBytes(digest)); // wrong signer
    await expect(
      f.registry.attest(f.payroll.target, runId, reportHash, pool, f.auditor.address, sig),
    ).to.be.revertedWithCustomError(f.registry, "BadSignature");
  });

  it("reverts BadSignature if the reportHash or total is tampered after signing", async () => {
    const f = await deploy();
    const { runId, pool } = await fundRun(f);
    const reportHash = ethers.keccak256("0xabcd");
    const digest = await f.registry.attestationDigest(f.payroll.target, runId, reportHash, pool, f.auditor.address);
    const sig = await f.auditor.signMessage(ethers.getBytes(digest));
    // submit a DIFFERENT hash with the old signature → recovered signer won't match
    await expect(
      f.registry.attest(f.payroll.target, runId, ethers.keccak256("0xeeee"), pool, f.auditor.address, sig),
    ).to.be.revertedWithCustomError(f.registry, "BadSignature");
    await expect(
      f.registry.attest(f.payroll.target, runId, reportHash, pool + 1n, f.auditor.address, sig),
    ).to.be.revertedWithCustomError(f.registry, "BadSignature");
  });

  it("reverts ZeroAuditor for a zero auditor address", async () => {
    const f = await deploy();
    const { runId, pool } = await fundRun(f);
    await expect(
      f.registry.attest(f.payroll.target, runId, ethers.ZeroHash, pool, ethers.ZeroAddress, "0x"),
    ).to.be.revertedWithCustomError(f.registry, "ZeroAuditor");
  });

  it("reverts WrongAuditor when the signer isn't the run's designated auditor", async () => {
    const f = await deploy();
    const { runId, pool } = await fundRun(f); // run's designated auditor = f.auditor.address
    const impostor = ethers.Wallet.createRandom();
    const reportHash = ethers.keccak256("0xc0ffee");
    // a validly-signed attestation, but from a key that is NOT the run's on-chain auditor
    const digest = await f.registry.attestationDigest(f.payroll.target, runId, reportHash, pool, impostor.address);
    const sig = await impostor.signMessage(ethers.getBytes(digest));
    await expect(
      f.registry.attest(f.payroll.target, runId, reportHash, pool, impostor.address, sig),
    ).to.be.revertedWithCustomError(f.registry, "WrongAuditor");
  });

  it("reverts AlreadyAttested on a second attestation for the same run", async () => {
    const f = await deploy();
    const { runId, pool } = await fundRun(f);
    const reportHash = ethers.keccak256("0xfeed");
    const digest = await f.registry.attestationDigest(f.payroll.target, runId, reportHash, pool, f.auditor.address);
    const sig = await f.auditor.signMessage(ethers.getBytes(digest));
    await (await f.registry.attest(f.payroll.target, runId, reportHash, pool, f.auditor.address, sig)).wait();
    // the (payroll, runId) attestation is now anchored; a second one cannot overwrite it
    await expect(
      f.registry.attest(f.payroll.target, runId, reportHash, pool, f.auditor.address, sig),
    ).to.be.revertedWithCustomError(f.registry, "AlreadyAttested");
  });

  it("FULL FLOW: generate a verified report, attest it, and independently verify", async () => {
    const f = await deploy();
    const { roster, salts, commits, pool, runId } = await fundRun(f);
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // ── GENERATION (auditor side) ──
    // The auditor has decrypted each slot to (amount, salt). They VERIFY every amount
    // against its on-chain commitment — a lying employer would be caught here.
    const reportSlots: { slot: bigint; amount: bigint; salt: string; commit: string }[] = [];
    for (let i = 0; i < roster.length; i++) {
      const onchain = (await f.payroll.getSlot(runId, i)).amountCommit;
      const recomputed = await f.payroll.amountCommit(roster[i], salts[i]);
      expect(recomputed).to.equal(onchain); // amount is provably the committed one
      expect(recomputed).to.equal(commits[i]);
      reportSlots.push({ slot: BigInt(i), amount: roster[i], salt: salts[i], commit: onchain });
    }
    const total = roster.reduce((a, b) => a + b, 0n);
    const reportHash = computeReportHash(f.payroll.target as string, runId, chainId, reportSlots, total);
    const digest = await f.registry.attestationDigest(f.payroll.target, runId, reportHash, total, f.auditor.address);
    const sig = await f.auditor.signMessage(ethers.getBytes(digest));
    await (await f.registry.attest(f.payroll.target, runId, reportHash, total, f.auditor.address, sig)).wait();

    // ── VERIFICATION (any third party, no secrets) ──
    // Given the published report {slots with amount+salt} + the chain:
    const att = await f.registry.getAttestation(f.payroll.target, runId);
    // 1) the attestation exists and was signed by the run's designated auditor
    expect(att.auditor).to.equal((await f.payroll.getRun(runId)).auditor);
    // 2) every reported amount matches the on-chain commitment
    for (const s of reportSlots) {
      const onchain = (await f.payroll.getSlot(runId, Number(s.slot))).amountCommit;
      expect(await f.payroll.amountCommit(s.amount, s.salt)).to.equal(onchain);
    }
    // 3) the report hash + total match what was anchored
    expect(computeReportHash(f.payroll.target as string, runId, chainId, reportSlots, total)).to.equal(att.reportHash);
    expect(att.verifiedTotal).to.equal(total);
    // 4) a forged report (bumped amount) fails the commitment check
    const forged = [{ ...reportSlots[0], amount: reportSlots[0].amount + usd(1000) }, reportSlots[1]];
    const onchain0 = (await f.payroll.getSlot(runId, 0)).amountCommit;
    expect(await f.payroll.amountCommit(forged[0].amount, forged[0].salt)).to.not.equal(onchain0);
  });
});
