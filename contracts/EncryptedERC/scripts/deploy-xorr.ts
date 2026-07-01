// XORR on Avalanche — deploy a STANDALONE Encrypted ERC (private-by-default money) to Fuji.
//
//   npx hardhat run scripts/deploy-xorr.ts --network fuji
//
// Mirrors deploy-standalone.ts but:
//   • uses PRODUCTION trusted-setup verifiers (isProd = true) — required for Fuji/mainnet
//   • names the token XORR Private USD / xUSD
//   • writes every deployed address to ../deployments/fuji.json so the web app can read it
import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { deployLibrary, deployVerifiers } from "../test/helpers";
import { EncryptedERC__factory } from "../typechain-types";
import { DECIMALS } from "./constants";

const TOKEN_NAME = process.env.XORR_NAME || "XORR Private USD";
const TOKEN_SYMBOL = process.env.XORR_SYMBOL || "xUSD";

const main = async () => {
	const [deployer] = await ethers.getSigners();
	const net = await ethers.provider.getNetwork();
	const bal = await ethers.provider.getBalance(deployer.address);
	console.log(`\nXORR eERC deploy → chainId ${net.chainId}`);
	console.log(`Deployer: ${deployer.address}  (${ethers.formatEther(bal)} AVAX)\n`);
	if (bal === 0n) {
		throw new Error(
			"Deployer has 0 AVAX. Fund it from the Fuji faucet: https://core.app/tools/testnet-faucet",
		);
	}

	// 1) Verifiers — isProd=true => production trusted-setup verifiers (Fuji/mainnet)
	console.log("Deploying verifiers (production trusted setup)…");
	const {
		registrationVerifier,
		mintVerifier,
		withdrawVerifier,
		transferVerifier,
		burnVerifier,
	} = await deployVerifiers(deployer, true);

	// 2) BabyJubJub library
	console.log("Deploying BabyJubJub library…");
	const babyJubJub = await deployLibrary(deployer);

	// 3) Registrar
	console.log("Deploying Registrar…");
	const registrarFactory = await ethers.getContractFactory("Registrar");
	const registrar = await registrarFactory.deploy(registrationVerifier);
	await registrar.waitForDeployment();

	// 4) EncryptedERC (standalone => isConverter:false)
	console.log("Deploying EncryptedERC (standalone)…");
	const encryptedERCFactory = new EncryptedERC__factory({
		"contracts/libraries/BabyJubJub.sol:BabyJubJub": babyJubJub,
	});
	const eerc = await encryptedERCFactory.connect(deployer).deploy({
		registrar: registrar.target,
		isConverter: false,
		name: TOKEN_NAME,
		symbol: TOKEN_SYMBOL,
		mintVerifier,
		withdrawVerifier,
		transferVerifier,
		burnVerifier,
		decimals: DECIMALS,
	});
	await eerc.waitForDeployment();

	const out = {
		network: "fuji",
		chainId: Number(net.chainId),
		name: TOKEN_NAME,
		symbol: TOKEN_SYMBOL,
		decimals: DECIMALS,
		deployer: deployer.address,
		encryptedERC: String(eerc.target),
		registrar: String(registrar.target),
		babyJubJub: String(babyJubJub),
		verifiers: {
			registration: registrationVerifier,
			mint: mintVerifier,
			transfer: transferVerifier,
			withdraw: withdrawVerifier,
			burn: burnVerifier,
		},
		deployedAt: new Date().toISOString(),
	};

	console.table({
		encryptedERC: out.encryptedERC,
		registrar: out.registrar,
		babyJubJub: out.babyJubJub,
		...out.verifiers,
	});

	const dir = path.join(__dirname, "..", "deployments");
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, "fuji.json");
	fs.writeFileSync(file, JSON.stringify(out, null, 2));
	console.log(`\n✅ Saved addresses → ${file}`);
	console.log(
		`\nNext:\n  1) Copy encryptedERC into web/.env.local (NEXT_PUBLIC_EERC_ADDRESS)\n  2) Set an auditor with setAuditorPublicKey once an auditor wallet has registered\n  3) Register users, then privateMint / privateTransfer\n`,
	);
};

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
