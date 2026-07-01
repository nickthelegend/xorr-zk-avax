// XORR swap test — the public AMM venue, and a confidential swap composed with
// the eERC.
//
//   Public swap:       swap 50 USDC → XAV on the constant-product AMM.
//   Confidential swap: user burns 50 xUSD on the eERC (amount hidden), the
//                      relayer swaps the equivalent USDC → XAV and sends the
//                      output to a FRESH address — no on-chain link to the user.
//
//   npx hardhat test test/xorr-swap.ts
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
import {
  EncryptedERC__factory,
  SimpleERC20__factory,
  XorrAMM__factory,
} from "../typechain-types";
import type { RegistrationCircuit } from "../generated-types/zkit";

const units = (n: number) => BigInt(Math.round(n * 100)); // 2 decimals
const fmt = (v: bigint) => (Number(v) / 100).toFixed(2);

describe("XorrAMM — public swap + confidential swap via eERC", function () {
  this.timeout(600_000);

  it("swaps USDC→XAV on the AMM (public)", async () => {
    const [owner, lp, trader] = await ethers.getSigners();
    const usdc = await new SimpleERC20__factory(owner).deploy("USD Coin", "USDC", 2);
    const xav = await new SimpleERC20__factory(owner).deploy("Xorr Asset", "XAV", 2);
    const amm = await new XorrAMM__factory(owner).deploy(usdc.target, xav.target);

    // seed a 1000/1000 pool
    await (await usdc.mint(lp.address, units(1000))).wait();
    await (await xav.mint(lp.address, units(1000))).wait();
    await (await usdc.connect(lp).approve(amm.target, units(1000))).wait();
    await (await xav.connect(lp).approve(amm.target, units(1000))).wait();
    await (await amm.connect(lp).addLiquidity(units(1000), units(1000))).wait();

    // trader swaps 50 USDC → XAV
    await (await usdc.mint(trader.address, units(50))).wait();
    await (await usdc.connect(trader).approve(amm.target, units(50))).wait();
    const quoted = await amm.quote(usdc.target, units(50));
    await (await amm.connect(trader).swap(usdc.target, units(50), quoted, trader.address)).wait();

    expect(await xav.balanceOf(trader.address)).to.equal(quoted);
    expect(quoted).to.be.greaterThan(units(47)); // ~47.6 XAV after fee + slippage
    console.log(`    ✓ public swap: 50.00 USDC → ${fmt(quoted)} XAV`);
  });

  it("confidential swap: burn xUSD → relayer swaps → output to a fresh address", async () => {
    const signers = await ethers.getSigners();
    const owner = signers[0]; // eERC owner + auditor + relayer + LP
    const user = new User(signers[1]);
    const auditor = new User(signers[0]);
    const freshOut = ethers.Wallet.createRandom().address; // unlinked payout

    // tokens + AMM (relayer seeds liquidity)
    const usdc = await new SimpleERC20__factory(owner).deploy("USD Coin", "USDC", 2);
    const xav = await new SimpleERC20__factory(owner).deploy("Xorr Asset", "XAV", 2);
    const amm = await new XorrAMM__factory(owner).deploy(usdc.target, xav.target);
    await (await usdc.mint(owner.address, units(1000))).wait();
    await (await xav.mint(owner.address, units(1000))).wait();
    await (await usdc.approve(amm.target, units(1000))).wait();
    await (await xav.approve(amm.target, units(1000))).wait();
    await (await amm.addLiquidity(units(1000), units(1000))).wait();

    // eERC
    const { registrationVerifier, mintVerifier, withdrawVerifier, transferVerifier, burnVerifier } =
      await deployVerifiers(owner, false);
    const babyJubJub = await deployLibrary(owner);
    const registrar = await (await ethers.getContractFactory("Registrar")).deploy(registrationVerifier);
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
      const cd = await regCircuit.generateCalldata(await regCircuit.generateProof(input));
      await (await registrar.connect(u.signer).register({ proofPoints: cd.proofPoints, publicSignals: cd.publicSignals })).wait();
    }
    async function decBalance(u: User) {
      const b = await eerc.balanceOfStandalone(u.signer.address);
      return getDecryptedBalance(u.privateKey, b.amountPCTs, b.balancePCT, b.eGCT);
    }

    await register(auditor);
    await register(user);
    await (await eerc.connect(owner).setAuditorPublicKey(owner.address)).wait();
    const auditorPublicKey = [auditor.publicKey[0], auditor.publicKey[1]];

    // user holds 100 xUSD
    const mintCd = await privateMint(units(100), user.publicKey, auditorPublicKey);
    await (
      await eerc.connect(owner)["privateMint(address,((uint256[2],uint256[2][2],uint256[2]),uint256[24]))"](
        user.signer.address,
        { proofPoints: mintCd.proofPoints, publicSignals: mintCd.publicSignals },
      )
    ).wait();

    // ── confidential swap: user burns 50 xUSD (amount hidden on-chain) ────────
    const bal = await decBalance(user);
    const enc = await eerc.balanceOfStandalone(user.signer.address);
    const { proof, userBalancePCT } = await privateBurn(user, bal, units(50), [...enc.eGCT.c1, ...enc.eGCT.c2], auditorPublicKey);
    await (
      await eerc.connect(user.signer)["privateBurn(address,((uint256[2],uint256[2][2],uint256[2]),uint256[19]),uint256[7],bytes)"](
        user.signer.address,
        { proofPoints: proof.proofPoints, publicSignals: proof.publicSignals },
        userBalancePCT,
        "0x",
      )
    ).wait();
    expect(await decBalance(user)).to.equal(units(50));
    console.log("    ✓ user burned 50.00 xUSD on eERC (input amount hidden)");

    // relayer swaps the equivalent 50 USDC → XAV and sends output to a fresh addr
    await (await usdc.mint(owner.address, units(50))).wait();
    await (await usdc.approve(amm.target, units(50))).wait();
    const quoted = await amm.quote(usdc.target, units(50));
    await (await amm.swap(usdc.target, units(50), quoted, freshOut)).wait();

    expect(await xav.balanceOf(freshOut)).to.equal(quoted);
    console.log(`    ✓ relayer swapped → ${fmt(quoted)} XAV delivered to a fresh, unlinked address`);
  });
});
