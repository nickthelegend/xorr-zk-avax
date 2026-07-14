import { ethers } from "hardhat";
import { ComplianceRegistry__factory } from "../typechain-types";
const main = async () => {
  const [d] = await ethers.getSigners();
  const c = await new ComplianceRegistry__factory(d).deploy();
  await c.waitForDeployment();
  console.log("ComplianceRegistry:", await c.getAddress());
};
main().catch((e) => { console.error(e); process.exitCode = 1; });
