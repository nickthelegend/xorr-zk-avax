// Client for the XORR Lending money market (Compound-style). Powers the Lend
// tab + the Markets page. Reads via simulation; mutations via signed invoke.
import { LENDING_ID, KEEPER_URL } from "./config";
import { simulateCall, invoke, addr, i128 } from "./stellar";

export interface KeeperStatus {
  ok: boolean;
  prices: Record<string, number>;
  borrowers: string[];
  liquidations: { borrower: string; health: string; repay: string; hash: string; ts: number }[];
}

/** Poll the lending keeper: live oracle prices + recent auto-liquidations. */
export async function keeperHealth(): Promise<KeeperStatus | null> {
  try { return await (await fetch(`${KEEPER_URL}/health`, { cache: "no-store" })).json(); } catch { return null; }
}

const INDEX_SCALE = 1_000_000_000n;
const PRICE_SCALE = 10_000_000n; // 1e7 — assets + prices are 7-decimal

export interface MarketInfo {
  asset: string;
  cash: bigint;
  totalBorrows: bigint;
  totalReserves: bigint;
  totalShares: bigint;
  borrowIndex: bigint;
  collateralFactor: number; // bps
  reserveFactor: number; // bps
  price: bigint; // USD 7-dec per whole token
  // derived
  totalSupplied: bigint; // cash + borrows - reserves (underlying)
  utilizationBps: number;
  supplyApyBps: number;
  borrowApyBps: number;
}

export interface Position {
  supplied: bigint; // underlying
  debt: bigint; // underlying
}

export interface Account {
  collateralValue: bigint; // USD 7-dec, risk-weighted
  borrowValue: bigint; // USD 7-dec
  healthBps: number; // collateral/borrow * 10000 (Infinity-ish when no debt)
}

export async function markets(): Promise<string[]> {
  return ((await simulateCall(LENDING_ID, "markets")) ?? []).map(String);
}

export async function getMarket(asset: string): Promise<MarketInfo> {
  const m = await simulateCall(LENDING_ID, "get_market", [addr(asset)]);
  const [supplyApyBps, borrowApyBps] = await rates(asset);
  const cash = BigInt(m.cash ?? 0);
  const totalBorrows = BigInt(m.total_borrows ?? 0);
  const totalReserves = BigInt(m.total_reserves ?? 0);
  const total = cash + totalBorrows;
  return {
    asset,
    cash,
    totalBorrows,
    totalReserves,
    totalShares: BigInt(m.total_shares ?? 0),
    borrowIndex: BigInt(m.borrow_index ?? INDEX_SCALE),
    collateralFactor: Number(m.collateral_factor ?? 0),
    reserveFactor: Number(m.reserve_factor ?? 0),
    price: BigInt(m.price ?? 0),
    totalSupplied: cash + totalBorrows - totalReserves,
    utilizationBps: total > 0n ? Number((totalBorrows * 10_000n) / total) : 0,
    supplyApyBps,
    borrowApyBps,
  };
}

export async function listMarkets(): Promise<MarketInfo[]> {
  const assets = await markets();
  const out: MarketInfo[] = [];
  for (const a of assets) {
    try { out.push(await getMarket(a)); } catch { /* skip */ }
  }
  return out;
}

export async function rates(asset: string): Promise<[number, number]> {
  const r = await simulateCall(LENDING_ID, "rates", [addr(asset)]);
  return [Number(r?.[0] ?? 0), Number(r?.[1] ?? 0)];
}

export async function position(asset: string, user: string): Promise<Position> {
  const p = await simulateCall(LENDING_ID, "position", [addr(asset), addr(user)]);
  return { supplied: BigInt(p?.[0] ?? 0), debt: BigInt(p?.[1] ?? 0) };
}

export async function account(user: string): Promise<Account> {
  const a = await simulateCall(LENDING_ID, "account", [addr(user)]);
  return { collateralValue: BigInt(a?.[0] ?? 0), borrowValue: BigInt(a?.[1] ?? 0), healthBps: Number(a?.[2] ?? 0) };
}

/** USD value (7-dec) of `amount` base units of `asset` at its oracle price. */
export function usdValue(amount: bigint, price: bigint): bigint {
  return (amount * price) / PRICE_SCALE;
}

/** The user's public (unshielded) SAC balance of `asset`. */
export async function assetBalance(asset: string, user: string): Promise<bigint> {
  try { return BigInt((await simulateCall(asset, "balance", [addr(user)])) ?? 0); } catch { return 0n; }
}

export async function supply(pk: string, asset: string, amount: bigint): Promise<string> {
  return (await invoke(pk, LENDING_ID, "supply", [addr(asset), addr(pk), i128(amount)])).hash;
}
export async function withdraw(pk: string, asset: string, amount: bigint): Promise<string> {
  return (await invoke(pk, LENDING_ID, "withdraw", [addr(asset), addr(pk), i128(amount)])).hash;
}
export async function borrow(pk: string, asset: string, amount: bigint): Promise<string> {
  return (await invoke(pk, LENDING_ID, "borrow", [addr(asset), addr(pk), i128(amount)])).hash;
}
export async function repay(pk: string, asset: string, amount: bigint): Promise<string> {
  return (await invoke(pk, LENDING_ID, "repay", [addr(asset), addr(pk), i128(amount)])).hash;
}
