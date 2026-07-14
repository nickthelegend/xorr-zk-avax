import { ethers } from "hardhat";
import { PayrollEscrow__factory } from "../typechain-types";

// Deploy PayrollEscrow to the configured network (Fuji).
//   npx hardhat run scripts/deploy-payroll.ts --network fuji
const main = async () => {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const payroll = await new PayrollEscrow__factory(deployer).deploy();
  await payroll.waitForDeployment();
  console.log("PayrollEscrow:", await payroll.getAddress());
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
