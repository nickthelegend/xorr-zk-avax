// Client for the XORR AMM (constant-product swaps). Read-only quote/reserves via
// simulation; swap is a signed invoke (Freighter or the custodial signer). The
// global tx listener (lib/stellar.ts) turns a successful swap into a toast that
// links to stellar.expert.
import { AMM_ID, SWAP_TOKEN_A, SWAP_TOKEN_B } from "./config";
import { simulateCall, invoke, addr, i128 } from "./stellar";

export interface SwapPair {
  inAddr: string;
  outAddr: string;
}

/** Current [reserveA, reserveB] (base units). */
export async function getReserves(): Promise<[bigint, bigint]> {
  const r = await simulateCall(AMM_ID, "get_reserves");
  const a = Array.isArray(r) ? r : [0, 0];
  return [BigInt(a[0] ?? 0), BigInt(a[1] ?? 0)];
}

/** Output amount for `amountIn` of `tokenIn`, via on-chain simulation. */
export async function quote(tokenIn: string, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const out = await simulateCall(AMM_ID, "quote", [addr(tokenIn), i128(amountIn)]);
  return BigInt(out ?? 0);
}

/** Execute a swap; returns the tx hash. `pk` is the connected account. */
export async function swap(
  pk: string,
  tokenIn: string,
  amountIn: bigint,
  minOut: bigint,
): Promise<string> {
  const { hash } = await invoke(pk, AMM_ID, "swap", [
    addr(pk),
    addr(tokenIn),
    i128(amountIn),
    i128(minOut),
  ]);
  return hash;
}

/** Token-balance of an account for a SAC (USDC/XLM), via simulation. */
export async function tokenBalance(token: string, account: string): Promise<bigint> {
  try {
    const b = await simulateCall(token, "balance", [addr(account)]);
    return BigInt(b ?? 0);
  } catch {
    return 0n;
  }
}

export function pairFor(direction: "AtoB" | "BtoA"): SwapPair {
  return direction === "AtoB"
    ? { inAddr: SWAP_TOKEN_A, outAddr: SWAP_TOKEN_B }
    : { inAddr: SWAP_TOKEN_B, outAddr: SWAP_TOKEN_A };
}
