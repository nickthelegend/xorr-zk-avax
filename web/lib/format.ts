import { ASSET_DECIMALS } from "./config";

const SCALE = 10n ** BigInt(ASSET_DECIMALS);

/** Display base units as a human amount string. */
export function fmt(base: bigint): string {
  const whole = base / SCALE;
  const frac = (base % SCALE).toString().padStart(ASSET_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a human amount string into base units. */
export function parseAmount(s: string): bigint {
  const [whole, frac = ""] = s.trim().split(".");
  const fracPadded = (frac + "0".repeat(ASSET_DECIMALS)).slice(0, ASSET_DECIMALS);
  return BigInt(whole || "0") * SCALE + BigInt(fracPadded || "0");
}

export function short(s: string, n = 6): string {
  return s.length > 2 * n ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}

/** Format 7-decimal base units as a 2-dp USD amount with thousands separators. */
export function usdFmt(base: bigint): string {
  return (Number(base) / Number(SCALE)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
