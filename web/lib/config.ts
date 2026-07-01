// Network + deployed-contract configuration. Populate the NEXT_PUBLIC_* vars in
// `.env.local` after running `scripts/deploy_testnet.sh` (which writes them for
// you). Defaults target Stellar Testnet.
export const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

// --- SEP-24 anchor (real on-chain testnet off-ramp / on-ramp) ----------------
// The SDF reference test anchor speaks real SEP-10 + SEP-24 on Stellar testnet
// with simulated ("fake banking") fiat rails — a genuine on-chain off-ramp that
// needs no signup or KYC. Point ANCHOR_DOMAIN at MoneyGram/Kado in production;
// the SEP-24 flow is identical. Classic payments go through Horizon (not RPC).
export const ANCHOR_DOMAIN = process.env.NEXT_PUBLIC_ANCHOR_DOMAIN ?? "testanchor.stellar.org";
export const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
// The test anchor's USDC (classic asset). Native XLM needs no trustline.
export const ANCHOR_USDC_ISSUER =
  process.env.NEXT_PUBLIC_ANCHOR_USDC_ISSUER ?? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export function anchorEnabled(): boolean {
  return Boolean(ANCHOR_DOMAIN);
}

// Defaults point at the live Xorr testnet deployment (deployed under our own
// `xorr` key, 2026-06-21) so the wallet is configured out of the box; override
// any of these via NEXT_PUBLIC_* env vars (scripts/deploy_xorr.sh writes them).
// ZK-swap pool (privacy-pool build with `private_swap`, wired to the AMM venue).
export const POOL_ID = process.env.NEXT_PUBLIC_POOL_ID ?? "CA5T3ZM6EFLSOFI5ZAWMN3CZV6U5I2BCCH2W6JSXNYCH3CVRG4BVFZ65";
// Bridge we control (admin+relayer=xorr), mints into POOL_ID; funded with USDC.
// v2: also verifies ETH deposit-tree membership against a relayer-posted root.
export const BRIDGE_ID = process.env.NEXT_PUBLIC_BRIDGE_ID ?? "CBTSR6QKVGVTJ2NTJABVAETXZIV7H5UZG745L4G6UZNHZIURIMLCHGGL";
export const VERIFIER_ID = process.env.NEXT_PUBLIC_VERIFIER_ID ?? "CC46C65SFSA2QNNGZRRXAYTDB4S6V4MB52MGDBZC5A6NI3QG5H4L2FO2";
export const TOKEN_ID = process.env.NEXT_PUBLIC_TOKEN_ID ?? "CAD7OEAESCGR5XV2BA2AHZCWM6EVJEYBYOOCA3D3ZG4TCOBWWHMZVFIV";

export const TREE_DEPTH = Number(process.env.NEXT_PUBLIC_TREE_DEPTH ?? "20");

// Encrypted note-delivery + global-leaf indexer (MongoDB-backed). Empty = the
// wallet runs in single-user mode (own notes only, no cross-user send/receive).
// Point NEXT_PUBLIC_DELIVERY_URL at a running backend (e.g.
// http://localhost:8787) to enable cross-user Send/Receive and the off-ramp.
export const DELIVERY_URL = process.env.NEXT_PUBLIC_DELIVERY_URL ?? "";

export function deliveryEnabled(): boolean {
  return Boolean(DELIVERY_URL);
}

// --- Ethereum (Sepolia) side of the bridge ---
export const SEPOLIA_RPC = process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? "https://1rpc.io/sepolia";
export const ETH_LOCK = process.env.NEXT_PUBLIC_ETH_LOCK ?? "0x3E48BDF44BD676D3F8cCb796138bBDcDA17e4F25";
// Real ERC-20 USDC escrow (forward lock) + mintable TestUSDC + the relayer service.
export const ETH_USDC = process.env.NEXT_PUBLIC_ETH_USDC ?? "0xC01B461678119117d3359D45a0205C2706AD85Ee";
export const ETH_ESCROW = process.env.NEXT_PUBLIC_ETH_ESCROW ?? "0x60655E8F6D771934f3D57Ff4D5D662fe7A601F2E";
export const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:8790";
// Reverse leg: bridging OUT unshields the burned note to this bridge-controlled
// Stellar account (the relayer), conserving value on the Stellar side, before
// the relayer releases the equivalent USDC on Ethereum. Bound in the ZK proof.
export const BRIDGE_SINK = process.env.NEXT_PUBLIC_BRIDGE_SINK ?? "GBKZC3N4UVFZ54CAM7I26NWIDQLQJVPPUVDNLDBAS5PC3BAUA3GYOYXR";
export function bridgeLive(): boolean { return Boolean(ETH_USDC && ETH_ESCROW && RELAYER_URL); }
export const USDC_ISSUER = process.env.NEXT_PUBLIC_USDC_ISSUER ?? "GAVKGXALNNSW35QZKLVYL5CNORBEGHBF7KMHEEVW5LEHT5XVNQZDD6KI";

// ── eERC (Avalanche) asset config ───────────────────────────────────────────
// The standalone Encrypted ERC deployed by contracts/scripts/deploy-xorr.ts uses
// DECIMALS = 2. The shielded/private representation is branded "xUSD".
export const ASSET_DECIMALS = 2;
export const ASSET_SYMBOL = "xUSD";
export const SHIELDED_SYMBOL = "xUSD";

// --- Market assets (the SACs used by the lending markets + the bridge) ---
// token_a = USDC SAC (xUSDC's underlying), token_b = native XLM SAC.
export const SWAP_TOKEN_A = process.env.NEXT_PUBLIC_SWAP_TOKEN_A ?? TOKEN_ID;
export const SWAP_TOKEN_B = process.env.NEXT_PUBLIC_SWAP_TOKEN_B ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const SWAP_TOKEN_A_SYMBOL = process.env.NEXT_PUBLIC_SWAP_TOKEN_A_SYMBOL ?? "USDC";
export const SWAP_TOKEN_B_SYMBOL = process.env.NEXT_PUBLIC_SWAP_TOKEN_B_SYMBOL ?? "XLM";

// --- Swaps ---
// Standalone constant-product AMM (deploy_amm.sh) — the venue the privacy pool's
// `private_swap` (ZK swap) routes through.
export const AMM_ID = process.env.NEXT_PUBLIC_AMM_ID ?? "CD6W7BAZ7DBZB7ZAKLNCSQYQOAFKV36PGZZEGZAUSG3QIFYR3356VL4N";
export function swapEnabled(): boolean {
  return Boolean(AMM_ID);
}
// Multi-pool factory (create pools + confidential pools): deploy_pools.sh. Powers
// the public swap (pick a pool) + the pool creator.
export const POOL_FACTORY_ID = process.env.NEXT_PUBLIC_POOL_FACTORY_ID ?? "CADU5RQBNEDPIRLGWOEC62EIGAV6V54KGITMGJ52R2ODT6EUBM66NP55";
export function poolsEnabled(): boolean {
  return Boolean(POOL_FACTORY_ID);
}
// zUSD test stablecoin SAC.
export const ZUSD_ID = process.env.NEXT_PUBLIC_ZUSD_ID ?? "CBG4TNRHL2OV6476KIANZY3U5QCQEKC5ZOHY56ZTD7IFQ5TMQANN43TS";
// Known SAC address → display symbol, so pool listings show names not raw addresses.
const TOKEN_SYMBOLS: Record<string, string> = {
  [SWAP_TOKEN_A]: SWAP_TOKEN_A_SYMBOL,
  [SWAP_TOKEN_B]: SWAP_TOKEN_B_SYMBOL,
  [ZUSD_ID]: "zUSD",
};
export function tokenSymbol(address: string): string {
  return TOKEN_SYMBOLS[address] ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// --- Lending / borrowing money market (scripts/deploy_lending.sh) ---
// Compound-style: supply to earn, borrow against collateral. USDC + XLM markets.
export const LENDING_ID = process.env.NEXT_PUBLIC_LENDING_ID ?? "CAA65A76UFS5Q6NUEECGV232SDQ7HST5PSAWB6Y4FOZWA5TVZFJIOCL4";
export function lendingEnabled(): boolean {
  return Boolean(LENDING_ID);
}
// The listed market assets (the SACs the lending pool was seeded with).
export const LENDING_ASSETS = [SWAP_TOKEN_A, SWAP_TOKEN_B];
// Lending keeper: relays the live oracle price + auto-liquidates underwater positions.
export const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:8791";

// ── XORR on Avalanche — eERC (Fuji C-Chain) ─────────────────────────────────
// After deploying, set NEXT_PUBLIC_EERC_ADDRESS in web/.env.local to the
// EncryptedERC address printed by contracts/scripts/deploy-xorr.ts.
export const EERC_ADDRESS = (process.env.NEXT_PUBLIC_EERC_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const FUJI = {
  chainId: 43113,
  rpc:
    process.env.NEXT_PUBLIC_FUJI_RPC ||
    "https://api.avax-test.network/ext/bc/C/rpc",
  explorer: "https://testnet.snowtrace.io",
  faucet: "https://core.app/tools/testnet-faucet",
};

// Circuit artifacts served from public/circuits (copied from the contracts
// zkit build). Each op needs a wasm + zkey.
export const circuitURLs = {
  register: {
    wasm: "/circuits/registration.wasm",
    zkey: "/circuits/registration.zkey",
  },
  transfer: { wasm: "/circuits/transfer.wasm", zkey: "/circuits/transfer.zkey" },
  mint: { wasm: "/circuits/mint.wasm", zkey: "/circuits/mint.zkey" },
  withdraw: { wasm: "/circuits/withdraw.wasm", zkey: "/circuits/withdraw.zkey" },
  burn: { wasm: "/circuits/burn.wasm", zkey: "/circuits/burn.zkey" },
};

// Prover WASM assets used by the SDK proof pipeline.
export const proverURLs = {
  transferURL: "/circuits/transfer.wasm",
  multiWasmURL: "/circuits/transfer.wasm",
};

export function eercAddressSet(): boolean {
  return (
    EERC_ADDRESS !== "0x0000000000000000000000000000000000000000"
  );
}

// eERC replaces the Stellar pool: "configured" now means an EncryptedERC address
// is present.
export function isConfigured(): boolean {
  return eercAddressSet();
}

export function explorerTx(hash: string): string {
  return `${FUJI.explorer}/tx/${hash}`;
}

// A funded account used only as the SOURCE for read-only simulations (pool
// reserves, quotes, chain state) so the UI can load on-chain data before any
// wallet connects. Overridden by the connected wallet once available.
export const SIM_SOURCE =
  process.env.NEXT_PUBLIC_SIM_SOURCE ?? "GBKZC3N4UVFZ54CAM7I26NWIDQLQJVPPUVDNLDBAS5PC3BAUA3GYOYXR";
