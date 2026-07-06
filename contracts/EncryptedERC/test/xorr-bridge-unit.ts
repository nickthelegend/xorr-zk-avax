// XorrBridge unit tests — access control, revert paths, event emission, and
// nonce/accounting bookkeeping. These are pure-Solidity behaviors that don't
// require ZK proof generation, so they run fast and deterministically.
//
//   npx hardhat test test/xorr-bridge-unit.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import { SimpleERC20__factory, XorrBridge__factory } from "../typechain-types";

const units = (n: number) => BigInt(Math.round(n * 100)); // 2 decimals

describe("XorrBridge — unit tests (access control, reverts, accounting)", function () {
  async function deployFixture() {
    const [owner, relayer, alice, bob, other] = await ethers.getSigners();
    const usdc = await new SimpleERC20__factory(owner).deploy("USD Coin", "USDC", 2);
    await usdc.waitForDeployment();
    const bridge = await new XorrBridge__factory(owner).deploy(usdc.target, relayer.address);
    await bridge.waitForDeployment();
    return { owner, relayer, alice, bob, other, usdc, bridge };
  }

  describe("constructor / initial state", () => {
    it("sets token, relayer, and zeroed counters", async () => {
      const { usdc, bridge, relayer } = await deployFixture();
      expect(await bridge.token()).to.equal(usdc.target);
      expect(await bridge.relayer()).to.equal(relayer.address);
      expect(await bridge.nonce()).to.equal(0n);
      expect(await bridge.totalLocked()).to.equal(0n);
    });
  });

  describe("lock()", () => {
    it("reverts with ZeroAmount when amount is 0", async () => {
      const { bridge, alice } = await deployFixture();
      await expect(bridge.connect(alice).lock(0n, bob_address())).to.be.revertedWithCustomError(
        bridge,
        "ZeroAmount",
      );
      function bob_address() {
        return alice.address; // recipient irrelevant for this revert path
      }
    });

    it("reverts if the caller has not approved the bridge", async () => {
      const { bridge, alice, bob } = await deployFixture();
      await expect(bridge.connect(alice).lock(units(10), bob.address)).to.be.reverted; // ERC20 insufficient allowance
    });

    it("transfers tokens in, increments nonce + totalLocked, and emits Locked", async () => {
      const { usdc, bridge, alice, bob, owner } = await deployFixture();
      await (await usdc.mint(alice.address, units(100))).wait();
      await (await usdc.connect(alice).approve(bridge.target, units(100))).wait();

      await expect(bridge.connect(alice).lock(units(40), bob.address))
        .to.emit(bridge, "Locked")
        .withArgs(1n, alice.address, bob.address, units(40));

      expect(await bridge.nonce()).to.equal(1n);
      expect(await bridge.totalLocked()).to.equal(units(40));
      expect(await usdc.balanceOf(bridge.target)).to.equal(units(40));
      expect(await usdc.balanceOf(alice.address)).to.equal(units(60));

      // a second lock increments the nonce again and accumulates totalLocked
      await (await usdc.mint(alice.address, units(10))).wait();
      await (await usdc.connect(alice).approve(bridge.target, units(10))).wait();
      await expect(bridge.connect(alice).lock(units(10), bob.address))
        .to.emit(bridge, "Locked")
        .withArgs(2n, alice.address, bob.address, units(10));
      expect(await bridge.nonce()).to.equal(2n);
      expect(await bridge.totalLocked()).to.equal(units(50));
    });

    it("returns the lock id from a static call", async () => {
      const { usdc, bridge, alice, bob } = await deployFixture();
      await (await usdc.mint(alice.address, units(5))).wait();
      await (await usdc.connect(alice).approve(bridge.target, units(5))).wait();
      const id = await bridge.connect(alice).lock.staticCall(units(5), bob.address);
      expect(id).to.equal(1n);
    });
  });

  describe("release() — access control + replay protection", () => {
    async function seedLocked(fixture: Awaited<ReturnType<typeof deployFixture>>, amount: bigint) {
      const { usdc, bridge, alice, bob } = fixture;
      await (await usdc.mint(alice.address, amount)).wait();
      await (await usdc.connect(alice).approve(bridge.target, amount)).wait();
      await (await bridge.connect(alice).lock(amount, bob.address)).wait();
    }

    it("reverts with NotRelayer when called by a non-relayer", async () => {
      const fixture = await deployFixture();
      const { bridge, other, bob } = fixture;
      await seedLocked(fixture, units(50));
      const nullifier = ethers.id("fake-nullifier-1");
      await expect(
        bridge.connect(other).release(bob.address, units(20), nullifier),
      ).to.be.revertedWithCustomError(bridge, "NotRelayer");
    });

    it("reverts with ZeroAmount when amount is 0", async () => {
      const fixture = await deployFixture();
      const { bridge, relayer, bob } = fixture;
      await seedLocked(fixture, units(50));
      const nullifier = ethers.id("fake-nullifier-2");
      await expect(
        bridge.connect(relayer).release(bob.address, 0n, nullifier),
      ).to.be.revertedWithCustomError(bridge, "ZeroAmount");
    });

    it("releases funds, decrements totalLocked, and emits Released", async () => {
      const fixture = await deployFixture();
      const { usdc, bridge, relayer, bob } = fixture;
      await seedLocked(fixture, units(50));
      const nullifier = ethers.id("fake-nullifier-3");

      await expect(bridge.connect(relayer).release(bob.address, units(20), nullifier))
        .to.emit(bridge, "Released")
        .withArgs(nullifier, bob.address, units(20));

      expect(await usdc.balanceOf(bob.address)).to.equal(units(20));
      expect(await bridge.totalLocked()).to.equal(units(30));
      expect(await bridge.released(nullifier)).to.equal(true);
    });

    it("reverts with AlreadyReleased on nullifier replay", async () => {
      const fixture = await deployFixture();
      const { bridge, relayer, bob } = fixture;
      await seedLocked(fixture, units(50));
      const nullifier = ethers.id("fake-nullifier-4");
      await (await bridge.connect(relayer).release(bob.address, units(10), nullifier)).wait();
      await expect(
        bridge.connect(relayer).release(bob.address, units(10), nullifier),
      ).to.be.revertedWithCustomError(bridge, "AlreadyReleased");
    });

    it("reverts (underflow) if release amount exceeds totalLocked", async () => {
      const fixture = await deployFixture();
      const { bridge, relayer, bob } = fixture;
      await seedLocked(fixture, units(10));
      const nullifier = ethers.id("fake-nullifier-5");
      await expect(bridge.connect(relayer).release(bob.address, units(999), nullifier)).to.be
        .reverted; // arithmetic underflow on totalLocked -= amount
    });
  });

  describe("setRelayer()", () => {
    it("reverts with NotRelayer when called by a non-relayer", async () => {
      const { bridge, other } = await deployFixture();
      await expect(bridge.connect(other).setRelayer(other.address)).to.be.revertedWithCustomError(
        bridge,
        "NotRelayer",
      );
    });

    it("allows the current relayer to rotate to a new relayer and emits RelayerChanged", async () => {
      const { bridge, relayer, other } = await deployFixture();
      await expect(bridge.connect(relayer).setRelayer(other.address))
        .to.emit(bridge, "RelayerChanged")
        .withArgs(other.address);
      expect(await bridge.relayer()).to.equal(other.address);
    });

    it("old relayer loses privileges after rotation; new relayer gains them", async () => {
      const { bridge, relayer, other, bob } = await deployFixture();
      await (await bridge.connect(relayer).setRelayer(other.address)).wait();

      // old relayer can no longer call onlyRelayer functions
      await expect(
        bridge.connect(relayer).release(bob.address, units(1), ethers.id("n")),
      ).to.be.revertedWithCustomError(bridge, "NotRelayer");

      // new relayer can (still reverts on ZeroAmount check path being skipped —
      // here we just confirm it's not NotRelayer, i.e. access control passed)
      await expect(
        bridge.connect(other).release(bob.address, 0n, ethers.id("n2")),
      ).to.be.revertedWithCustomError(bridge, "ZeroAmount");
    });
  });
});
