// Deploy XORR DeFi periphery to Fuji: test tokens (USDC, XAV), a seeded XorrAMM,
// and a XorrBridge escrow (relayer = deployer). Writes deployments/fuji-defi.json
// for the web app + relayer.
//
//   npx hardhat run scripts/deploy-xorr-defi.ts --network fuji
import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { SimpleERC20__factory, XorrAMM__factory, XorrBridge__factory } from "../typechain-types";

const units = (n: number) => BigInt(Math.round(n * 100)); // 2 decimals

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`\nXORR DeFi deploy → chainId ${net.chainId}\nDeployer: ${deployer.address}\n`);

  // Test tokens (2 decimals, open faucet mint).
  const usdc = await new SimpleERC20__factory(deployer).deploy("USD Coin (XORR test)", "USDC", 2);
  await usdc.waitForDeployment();
  const xav = await new SimpleERC20__factory(deployer).deploy("Xorr Asset", "XAV", 2);
  await xav.waitForDeployment();
  console.log(`USDC ${usdc.target}\nXAV  ${xav.target}`);

  // AMM, seeded with a 10,000 / 10,000 pool.
  const amm = await new XorrAMM__factory(deployer).deploy(usdc.target, xav.target);
  await amm.waitForDeployment();
  await (await usdc.mint(deployer.address, units(10000))).wait();
  await (await xav.mint(deployer.address, units(10000))).wait();
  await (await usdc.approve(amm.target, units(10000))).wait();
  await (await xav.approve(amm.target, units(10000))).wait();
  await (await amm.addLiquidity(units(10000), units(10000))).wait();
  console.log(`AMM  ${amm.target} (seeded 10000/10000)`);

  // Bridge escrow over USDC (relayer = deployer).
  const bridge = await new XorrBridge__factory(deployer).deploy(usdc.target, deployer.address);
  await bridge.waitForDeployment();
  console.log(`Bridge ${bridge.target} (relayer=deployer)`);

  const out = {
    network: "fuji",
    chainId: Number(net.chainId),
    usdc: String(usdc.target),
    xav: String(xav.target),
    amm: String(amm.target),
    bridge: String(bridge.target),
    relayer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fuji-defi.json"), JSON.stringify(out, null, 2));
  console.log(`\n✅ Saved → deployments/fuji-defi.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
