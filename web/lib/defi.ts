// XORR DeFi periphery on Fuji — addresses + minimal ABIs for the Swap & Bridge
// tabs. Addresses come from contracts/EncryptedERC/deployments/fuji-defi.json
// (single source in lib/config.ts) and can be overridden via NEXT_PUBLIC_* vars.
import {
  USDC_ADDRESS,
  XAV_ADDRESS,
  AMM_ADDRESS,
  BRIDGE_ADDRESS,
  ASSET_DECIMALS,
} from "./config";

export const DEFI = {
  usdc: USDC_ADDRESS,
  xav: XAV_ADDRESS,
  amm: AMM_ADDRESS,
  bridge: BRIDGE_ADDRESS,
  decimals: ASSET_DECIMALS,
};

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export const AMM_ABI = [
  { type: "function", name: "reserveA", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reserveB", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenA", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenB", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "quote", stateMutability: "view", inputs: [{ name: "tokenIn", type: "address" }, { name: "amountIn", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "tokenIn", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }, { name: "to", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const BRIDGE_ABI = [
  { type: "function", name: "lock", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "fujiRecipient", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalLocked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
