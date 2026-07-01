// @ts-nocheck
// Compat shim for @avalabs/ac-eerc-sdk, which was built against wagmi v1 and
// imports `erc20ABI` from "wagmi" — an export removed in wagmi v2. We alias
// `wagmi` (exact) to this shim in next.config.mjs: it re-exports the real wagmi
// v2 surface (via the `wagmi-real` alias, to avoid recursion) and adds the
// missing `erc20ABI` (viem's `erc20Abi`).
export * from "wagmi-real";
export { erc20Abi as erc20ABI } from "viem";
