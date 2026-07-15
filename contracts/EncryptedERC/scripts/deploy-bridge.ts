import { ethers } from "hardhat";
import { XorrBridge__factory } from "../typechain-types";
const USDC = "0x787bCE271940158A830453Ed9d6F8fB7B916BB76";
const main = async () => {
  const [d] = await ethers.getSigners();
  const c = await new XorrBridge__factory(d).deploy(USDC, d.address);
  await c.waitForDeployment();
  console.log("XorrBridge:", await c.getAddress());
};
main().catch((e) => { console.error(e); process.exitCode = 1; });
