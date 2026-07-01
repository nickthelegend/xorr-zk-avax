// Client for the XORR Pool Factory (multi-pool AMM). Powers the swap page and
// the pool creator. Read-only via simulation; mutations via signed invoke (the
// global tx listener fires a confetti + explorer toast on success).
import { POOL_FACTORY_ID } from "./config";
import { simulateCall, invoke, addr, i128, u32, bool } from "./stellar";

export interface PoolInfo {
  id: number;
  tokenA: string;
  tokenB: string;
  feeBps: number;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  confidential: boolean;
}

export async function poolCount(): Promise<number> {
  return Number((await simulateCall(POOL_FACTORY_ID, "pool_count")) ?? 0);
}

export async function getPool(id: number): Promise<PoolInfo> {
  const p = await simulateCall(POOL_FACTORY_ID, "get_pool", [u32(id)]);
  return {
    id,
    tokenA: String(p.token_a),
    tokenB: String(p.token_b),
    feeBps: Number(p.fee_bps),
    reserveA: BigInt(p.reserve_a ?? 0),
    reserveB: BigInt(p.reserve_b ?? 0),
    totalShares: BigInt(p.total_shares ?? 0),
    confidential: Boolean(p.confidential),
  };
}

export async function listPools(): Promise<PoolInfo[]> {
  const n = await poolCount();
  const out: PoolInfo[] = [];
  for (let i = 0; i < n; i++) {
    try { out.push(await getPool(i)); } catch { /* skip */ }
  }
  return out;
}

export async function quote(id: number, tokenIn: string, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  return BigInt((await simulateCall(POOL_FACTORY_ID, "quote", [u32(id), addr(tokenIn), i128(amountIn)])) ?? 0);
}

export async function swap(pk: string, id: number, tokenIn: string, amountIn: bigint, minOut: bigint): Promise<string> {
  const { hash } = await invoke(pk, POOL_FACTORY_ID, "swap", [u32(id), addr(pk), addr(tokenIn), i128(amountIn), i128(minOut)]);
  return hash;
}

export async function createPool(pk: string, tokenA: string, tokenB: string, feeBps: number, confidential: boolean): Promise<string> {
  const { hash } = await invoke(pk, POOL_FACTORY_ID, "create_pool", [addr(pk), addr(tokenA), addr(tokenB), u32(feeBps), bool(confidential)]);
  return hash;
}

export async function addLiquidity(pk: string, id: number, amountA: bigint, amountB: bigint): Promise<string> {
  const { hash } = await invoke(pk, POOL_FACTORY_ID, "add_liquidity", [u32(id), addr(pk), i128(amountA), i128(amountB)]);
  return hash;
}
