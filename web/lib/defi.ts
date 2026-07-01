// XORR DeFi periphery on Fuji — addresses + minimal ABIs for the Swap & Bridge
// tabs. Addresses come from contracts/scripts/deploy-xorr-defi.ts and can be
// overridden via NEXT_PUBLIC_* env vars.
export const DEFI = {
  usdc: (process.env.NEXT_PUBLIC_USDC ||
    "0x787bCE271940158A830453Ed9d6F8fB7B916BB76") as `0x${string}`,
  xav: (process.env.NEXT_PUBLIC_XAV ||
    "0x6eC47E4601dA3C6246A0cdc7721a39CF224Df390") as `0x${string}`,
  amm: (process.env.NEXT_PUBLIC_AMM ||
    "0x1A0236a0Fb5Ef1944F0200D62414A5366b0477E8") as `0x${string}`,
  bridge: (process.env.NEXT_PUBLIC_BRIDGE ||
    "0x9B30a93976a99df8aD9542eE8931cD78e027f110") as `0x${string}`,
  decimals: 2,
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
