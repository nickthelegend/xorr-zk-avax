// XORR on Avalanche — network + deployed-contract configuration.
//
// This app runs its confidential-money flows on **Avalanche Fuji (C-Chain)**
// against the deployed **Encrypted ERC (eERC)** stack. Every address below
// defaults to a real, live Fuji deployment (see
// contracts/EncryptedERC/deployments/fuji.json + fuji-defi.json) so the app is
// fully configured out of the box. Override any value with the matching
// NEXT_PUBLIC_* env var in web/.env.local.

// ── Network ─────────────────────────────────────────────────────────────────
export const FUJI = {
  chainId: 43113,
  rpc:
    process.env.NEXT_PUBLIC_FUJI_RPC ||
    "https://api.avax-test.network/ext/bc/C/rpc",
  explorer: "https://testnet.snowtrace.io",
  faucet: "https://core.app/tools/testnet-faucet",
};

// ── Encrypted ERC (eERC) core — contracts/EncryptedERC/deployments/fuji.json ──
// EncryptedERC: the confidential token. Balances + amounts are ciphertext
// on-chain; the contract only verifies zk-SNARK proofs.
export const EERC_ADDRESS = (process.env.NEXT_PUBLIC_EERC_ADDRESS ||
  "0xe4c10B6Cd5364B79d1136a35c1CD4b4f46f6574A") as `0x${string}`;

// Registrar: BabyJubJub public-key registry (one-time user registration).
export const REGISTRAR_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRAR ||
  "0xB51479e60CC36810836972BCDEeFFdeec09004Db") as `0x${string}`;

// BabyJubJub elliptic-curve library used by the eERC crypto.
export const BABYJUBJUB_ADDRESS = (process.env.NEXT_PUBLIC_BABYJUBJUB ||
  "0xba675F27dF7F59D5e547Ee82F691b903eAC23581") as `0x${string}`;

// Groth16 verifier contracts for each confidential operation.
export const VERIFIERS = {
  registration: (process.env.NEXT_PUBLIC_VERIFIER_REGISTRATION ||
    "0x1E468EFFA30Cf3C4b6da57c282357bE10E744DFa") as `0x${string}`,
  mint: (process.env.NEXT_PUBLIC_VERIFIER_MINT ||
    "0x8E1c326a159657d2DeE3f3a5246f32170a54afC1") as `0x${string}`,
  transfer: (process.env.NEXT_PUBLIC_VERIFIER_TRANSFER ||
    "0x018a953267FFf33D36702be131f831932ca703a0") as `0x${string}`,
  withdraw: (process.env.NEXT_PUBLIC_VERIFIER_WITHDRAW ||
    "0xFe9F70E9B0f75931618B3Ca73ADD180A4a42Ac0d") as `0x${string}`,
  burn: (process.env.NEXT_PUBLIC_VERIFIER_BURN ||
    "0x43a1e9f75Eb8abfA54c0d7E16eBFd64444E4a5EA") as `0x${string}`,
} as const;

// ── DeFi periphery — contracts/EncryptedERC/deployments/fuji-defi.json ────────
// Underlying public ERC-20 (the eERC deposit / bridge token), the XAV pair
// token, the XorrAMM (constant-product swap) and the XorrBridge (lock → mint).
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC ||
  "0x787bCE271940158A830453Ed9d6F8fB7B916BB76") as `0x${string}`;
export const XAV_ADDRESS = (process.env.NEXT_PUBLIC_XAV ||
  "0x6eC47E4601dA3C6246A0cdc7721a39CF224Df390") as `0x${string}`;
export const AMM_ADDRESS = (process.env.NEXT_PUBLIC_AMM ||
  "0x1A0236a0Fb5Ef1944F0200D62414A5366b0477E8") as `0x${string}`;
export const BRIDGE_ADDRESS = (process.env.NEXT_PUBLIC_BRIDGE ||
  "0x9B30a93976a99df8aD9542eE8931cD78e027f110") as `0x${string}`;
// PayrollEscrow — claim-link batch payroll (deployed 2026-07-14).
export const PAYROLL_ADDRESS = (process.env.NEXT_PUBLIC_PAYROLL ||
  "0x02D86e65653B9C962D3b9616C13dD3cF34aF2019") as `0x${string}`;
// ConfidentialPayroll — hidden-amount payroll + compliance ciphers (v2).
export const CONF_PAYROLL_ADDRESS = (process.env.NEXT_PUBLIC_CONF_PAYROLL ||
  "0xf13e2A0631C9c52124DCaE61103137341729FE03") as `0x${string}`;
// ComplianceRegistry — on-chain signed attestation of verified confidential runs.
export const COMPLIANCE_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_COMPLIANCE ||
  "0x0AdaA34B9C8f43b423EB976fF107CfeB890d2E53") as `0x${string}`;
export const RELAYER_ADDRESS = (process.env.NEXT_PUBLIC_RELAYER ||
  "0x86076053d71E1c95b3c08e68BA39049024D69E67") as `0x${string}`;

// ── Asset metadata ────────────────────────────────────────────────────────────
// The deployed EncryptedERC (cUSD) uses DECIMALS = 2. The shielded/private
// representation is branded "xUSD" in the UI.
export const ASSET_DECIMALS = 2;
export const ASSET_SYMBOL = "xUSD";
export const SHIELDED_SYMBOL = "xUSD";

// ── zk circuit + prover artifacts (served from public/circuits) ──────────────
// Each confidential op needs a wasm + zkey (copied from the contracts zkit build).
// The eERC SDK treats a path that doesn't start with "http" as a filesystem path
// and prepends "file://" (→ `file:///circuits/mint.wasm`, unfetchable in-browser),
// so we resolve to ABSOLUTE http(s) URLs against the page origin on the client.
// During SSR `window` is absent, so these stay root-relative (the engine only
// initialises useEERC on the client, after `window` exists).
const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";
const asset = (p: string) => `${ORIGIN}${p}`;

export const circuitURLs = {
  register: {
    wasm: asset("/circuits/registration.wasm"),
    zkey: asset("/circuits/registration.zkey"),
  },
  transfer: { wasm: asset("/circuits/transfer.wasm"), zkey: asset("/circuits/transfer.zkey") },
  mint: { wasm: asset("/circuits/mint.wasm"), zkey: asset("/circuits/mint.zkey") },
  withdraw: { wasm: asset("/circuits/withdraw.wasm"), zkey: asset("/circuits/withdraw.zkey") },
  burn: { wasm: asset("/circuits/burn.wasm"), zkey: asset("/circuits/burn.zkey") },
};

// Prover WASM assets used by the SDK proof pipeline.
export const proverURLs = {
  transferURL: asset("/circuits/transfer.wasm"),
  multiWasmURL: asset("/circuits/transfer.wasm"),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export function eercAddressSet(): boolean {
  return EERC_ADDRESS !== "0x0000000000000000000000000000000000000000";
}

// "Configured" means a live EncryptedERC address is present. Defaults to the
// deployed Fuji contract, so this is true out of the box.
export function isConfigured(): boolean {
  return eercAddressSet();
}

export function explorerTx(hash: string): string {
  return `${FUJI.explorer}/tx/${hash}`;
}

export function explorerAddress(addr: string): string {
  return `${FUJI.explorer}/address/${addr}`;
}
