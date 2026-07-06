// XorrAMM unit tests — constant-product math, revert paths, event emission,
// and liquidity accounting. Pure-Solidity behavior, no ZK proofs needed.
//
//   npx hardhat test test/xorr-amm-unit.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import { SimpleERC20__factory, XorrAMM__factory } from "../typechain-types";

const units = (n: number) => BigInt(Math.round(n * 100)); // 2 decimals

describe("XorrAMM — unit tests (math, reverts, accounting)", function () {
  async function deployFixture() {
    const [owner, lp, trader, other] = await ethers.getSigners();
    const tokenA = await new SimpleERC20__factory(owner).deploy("USD Coin", "USDC", 2);
    const tokenB = await new SimpleERC20__factory(owner).deploy("Xorr Asset", "XAV", 2);
    const amm = await new XorrAMM__factory(owner).deploy(tokenA.target, tokenB.target);
    await amm.waitForDeployment();
    return { owner, lp, trader, other, tokenA, tokenB, amm };
  }

  describe("constructor / initial state", () => {
    it("sets tokenA, tokenB, and zero reserves", async () => {
      const { amm, tokenA, tokenB } = await deployFixture();
      expect(await amm.tokenA()).to.equal(tokenA.target);
      expect(await amm.tokenB()).to.equal(tokenB.target);
      expect(await amm.reserveA()).to.equal(0n);
      expect(await amm.reserveB()).to.equal(0n);
    });
  });

  describe("getAmountOut() — pure constant-product math with 0.3% fee", () => {
    it("returns 0 when amountIn is 0", async () => {
      const { amm } = await deployFixture();
      expect(await amm.getAmountOut(0n, units(1000), units(1000))).to.equal(0n);
    });

    it("matches the constant-product formula with fee", async () => {
      const { amm } = await deployFixture();
      const amountIn = units(50);
      const reserveIn = units(1000);
      const reserveOut = units(1000);
      const amountInWithFee = amountIn * 997n;
      const expected = (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
      expect(await amm.getAmountOut(amountIn, reserveIn, reserveOut)).to.equal(expected);
    });

    it("gives less than the naive (no-fee) output", async () => {
      const { amm } = await deployFixture();
      const amountIn = units(50);
      const reserveIn = units(1000);
      const reserveOut = units(1000);
      const noFeeOutput = (amountIn * reserveOut) / (reserveIn + amountIn);
      const withFee = await amm.getAmountOut(amountIn, reserveIn, reserveOut);
      expect(withFee).to.be.lessThan(noFeeOutput);
    });

    it("larger trades suffer more slippage (worse marginal rate)", async () => {
      const { amm } = await deployFixture();
      const small = await amm.getAmountOut(units(10), units(1000), units(1000));
      const large = await amm.getAmountOut(units(500), units(1000), units(1000));
      // rate = out/in; small trade should have a better (higher) rate than large
      const smallRate = (small * 10_000n) / units(10);
      const largeRate = (large * 10_000n) / units(500);
      expect(smallRate).to.be.greaterThan(largeRate);
    });
  });

  describe("addLiquidity()", () => {
    it("reverts with ZeroAmount if either amount is 0", async () => {
      const { amm, lp } = await deployFixture();
      await expect(amm.connect(lp).addLiquidity(0n, units(10))).to.be.revertedWithCustomError(
        amm,
        "ZeroAmount",
      );
      await expect(amm.connect(lp).addLiquidity(units(10), 0n)).to.be.revertedWithCustomError(
        amm,
        "ZeroAmount",
      );
    });

    it("reverts if the caller has insufficient allowance", async () => {
      const { amm, lp } = await deployFixture();
      await expect(amm.connect(lp).addLiquidity(units(10), units(10))).to.be.reverted;
    });

    it("pulls both tokens, updates reserves, and emits LiquidityAdded", async () => {
      const { amm, tokenA, tokenB, lp } = await deployFixture();
      await (await tokenA.mint(lp.address, units(1000))).wait();
      await (await tokenB.mint(lp.address, units(1000))).wait();
      await (await tokenA.connect(lp).approve(amm.target, units(1000))).wait();
      await (await tokenB.connect(lp).approve(amm.target, units(1000))).wait();

      await expect(amm.connect(lp).addLiquidity(units(1000), units(1000)))
        .to.emit(amm, "LiquidityAdded")
        .withArgs(lp.address, units(1000), units(1000));

      expect(await amm.reserveA()).to.equal(units(1000));
      expect(await amm.reserveB()).to.equal(units(1000));
      expect(await tokenA.balanceOf(amm.target)).to.equal(units(1000));
      expect(await tokenB.balanceOf(amm.target)).to.equal(units(1000));
    });

    it("accumulates reserves across multiple deposits", async () => {
      const { amm, tokenA, tokenB, lp } = await deployFixture();
      await (await tokenA.mint(lp.address, units(300))).wait();
      await (await tokenB.mint(lp.address, units(300))).wait();
      await (await tokenA.connect(lp).approve(amm.target, units(300))).wait();
      await (await tokenB.connect(lp).approve(amm.target, units(300))).wait();

      await (await amm.connect(lp).addLiquidity(units(100), units(100))).wait();
      await (await amm.connect(lp).addLiquidity(units(200), units(200))).wait();

      expect(await amm.reserveA()).to.equal(units(300));
      expect(await amm.reserveB()).to.equal(units(300));
    });
  });

  describe("quote()", () => {
    it("reverts with BadToken for an unknown token", async () => {
      const { amm, other } = await deployFixture();
      await expect(amm.quote(other.address, units(10))).to.be.revertedWithCustomError(
        amm,
        "BadToken",
      );
    });

    it("quotes both directions (tokenA-in and tokenB-in) consistently with getAmountOut", async () => {
      const { amm, tokenA, tokenB, lp } = await deployFixture();
      await (await tokenA.mint(lp.address, units(1000))).wait();
      await (await tokenB.mint(lp.address, units(1000))).wait();
      await (await tokenA.connect(lp).approve(amm.target, units(1000))).wait();
      await (await tokenB.connect(lp).approve(amm.target, units(1000))).wait();
      await (await amm.connect(lp).addLiquidity(units(1000), units(1000))).wait();

      const quoteAIn = await amm.quote(tokenA.target, units(50));
      const expectedAIn = await amm.getAmountOut(units(50), units(1000), units(1000));
      expect(quoteAIn).to.equal(expectedAIn);

      const quoteBIn = await amm.quote(tokenB.target, units(50));
      const expectedBIn = await amm.getAmountOut(units(50), units(1000), units(1000));
      expect(quoteBIn).to.equal(expectedBIn);
    });
  });

  describe("swap()", () => {
    async function seedPool(fixture: Awaited<ReturnType<typeof deployFixture>>) {
      const { amm, tokenA, tokenB, lp } = fixture;
      await (await tokenA.mint(lp.address, units(1000))).wait();
      await (await tokenB.mint(lp.address, units(1000))).wait();
      await (await tokenA.connect(lp).approve(amm.target, units(1000))).wait();
      await (await tokenB.connect(lp).approve(amm.target, units(1000))).wait();
      await (await amm.connect(lp).addLiquidity(units(1000), units(1000))).wait();
    }

    it("reverts with ZeroAmount when amountIn is 0", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, tokenA, trader } = fixture;
      await expect(
        amm.connect(trader).swap(tokenA.target, 0n, 0n, trader.address),
      ).to.be.revertedWithCustomError(amm, "ZeroAmount");
    });

    it("reverts with BadToken for a token not in the pool", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, other, trader } = fixture;
      await expect(
        amm.connect(trader).swap(other.address, units(10), 0n, trader.address),
      ).to.be.revertedWithCustomError(amm, "BadToken");
    });

    it("reverts with Slippage when minOut is not met", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, tokenA, trader } = fixture;
      await (await tokenA.mint(trader.address, units(50))).wait();
      await (await tokenA.connect(trader).approve(amm.target, units(50))).wait();
      const quoted = await amm.quote(tokenA.target, units(50));
      await expect(
        amm.connect(trader).swap(tokenA.target, units(50), quoted + 1n, trader.address),
      ).to.be.revertedWithCustomError(amm, "Slippage");
    });

    it("swaps tokenA→tokenB, updates reserves both ways, and emits Swap", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, tokenA, tokenB, trader } = fixture;
      await (await tokenA.mint(trader.address, units(50))).wait();
      await (await tokenA.connect(trader).approve(amm.target, units(50))).wait();
      const quoted = await amm.quote(tokenA.target, units(50));

      await expect(amm.connect(trader).swap(tokenA.target, units(50), quoted, trader.address))
        .to.emit(amm, "Swap")
        .withArgs(trader.address, tokenA.target, units(50), quoted);

      expect(await tokenB.balanceOf(trader.address)).to.equal(quoted);
      expect(await amm.reserveA()).to.equal(units(1000) + units(50));
      expect(await amm.reserveB()).to.equal(units(1000) - quoted);
    });

    it("swaps tokenB→tokenA symmetrically", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, tokenA, tokenB, trader } = fixture;
      await (await tokenB.mint(trader.address, units(50))).wait();
      await (await tokenB.connect(trader).approve(amm.target, units(50))).wait();
      const quoted = await amm.quote(tokenB.target, units(50));

      await expect(amm.connect(trader).swap(tokenB.target, units(50), quoted, trader.address))
        .to.emit(amm, "Swap")
        .withArgs(trader.address, tokenB.target, units(50), quoted);

      expect(await tokenA.balanceOf(trader.address)).to.equal(quoted);
      expect(await amm.reserveB()).to.equal(units(1000) + units(50));
      expect(await amm.reserveA()).to.equal(units(1000) - quoted);
    });

    it("can send swap output to a different address than the caller", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, tokenA, tokenB, trader, other } = fixture;
      await (await tokenA.mint(trader.address, units(50))).wait();
      await (await tokenA.connect(trader).approve(amm.target, units(50))).wait();
      const quoted = await amm.quote(tokenA.target, units(50));

      await (await amm.connect(trader).swap(tokenA.target, units(50), quoted, other.address)).wait();

      expect(await tokenB.balanceOf(other.address)).to.equal(quoted);
      expect(await tokenB.balanceOf(trader.address)).to.equal(0n);
    });

    it("reverts if the trader has insufficient allowance for amountIn", async () => {
      const fixture = await deployFixture();
      await seedPool(fixture);
      const { amm, tokenA, trader } = fixture;
      await (await tokenA.mint(trader.address, units(50))).wait();
      // no approve
      await expect(amm.connect(trader).swap(tokenA.target, units(50), 0n, trader.address)).to.be
        .reverted;
    });
  });
});
