import { ethers } from "hardhat";
import { ConfidentialPayroll__factory } from "../typechain-types";
const main = async () => {
  const [d] = await ethers.getSigners();
  const c = await new ConfidentialPayroll__factory(d).deploy();
  await c.waitForDeployment();
  console.log("ConfidentialPayroll:", await c.getAddress());
};
main().catch((e) => { console.error(e); process.exitCode = 1; });
