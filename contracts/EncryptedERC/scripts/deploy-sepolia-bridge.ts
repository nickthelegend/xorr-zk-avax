// Deploy the SOURCE-chain side of the cross-chain bridge on Ethereum Sepolia:
// a test USDC + a XorrBridge escrow (relayer = deployer). The relayer then mints
// confidential xUSD on Fuji when it sees a `Locked` event here.
//
//   npx hardhat run scripts/deploy-sepolia-bridge.ts --network sepolia
import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { SimpleERC20__factory, XorrBridge__factory } from "../typechain-types";

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`\nSepolia bridge deploy → chainId ${net.chainId}`);
  console.log(`Deployer: ${deployer.address} (${ethers.formatEther(bal)} ETH)\n`);
  if (bal === 0n) throw new Error("Deployer has 0 Sepolia ETH — fund it first (e.g. sepoliafaucet.com).");

  const usdc = await new SimpleERC20__factory(deployer).deploy("USD Coin (XORR test)", "USDC", 2);
  await usdc.waitForDeployment();
  const bridge = await new XorrBridge__factory(deployer).deploy(usdc.target, deployer.address);
  await bridge.waitForDeployment();

  console.log(`USDC   ${usdc.target}`);
  console.log(`Bridge ${bridge.target} (relayer=deployer)`);

  const out = {
    network: "sepolia",
    chainId: Number(net.chainId),
    usdc: String(usdc.target),
    bridge: String(bridge.target),
    relayer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sepolia.json"), JSON.stringify(out, null, 2));
  console.log(`\n✅ Saved → deployments/sepolia.json`);
  console.log(`\nNext: run the cross-chain relayer (on fuji, reading Sepolia):`);
  console.log(`  npx hardhat run scripts/relayer-xchain.ts --network fuji\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
