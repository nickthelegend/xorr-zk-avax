// Off-ramp client (shielded USDC -> fiat), backed by the sandbox rail layer.
// Mirrors the Midnight off-ramp lifecycle: quote -> initiate -> lock -> settle,
// with an Ed25519 settlement-oracle attestation on success.
import { DELIVERY_URL } from "./config";

const api = (p: string) => `${DELIVERY_URL.replace(/\/$/, "")}/offramp${p}`;
const post = (p: string, body: unknown) =>
  fetch(api(p), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export interface Quote {
  rail: string; currency: string; usdcAmount: string; rate: number;
  feeBps: number; fee: string; fiatOut: string; quotedAt: number;
}
export interface Attestation { canonical: string; signature: string; oracle: string; }

export async function getRails(): Promise<{ oracle: string; rails: { id: string; feeBps: number; currencies: string[] }[] } | null> {
  try { return await (await fetch(api("/rails"))).json(); } catch { return null; }
}
export const quote = (rail: string, usdcAmount: string, currency: string): Promise<Quote> =>
  post("/quote", { rail, usdcAmount, currency });
export const initiate = (body: { rail: string; usdcAmount: string; currency: string; payoutHandle?: string }): Promise<{ intentId: string; quote: Quote }> =>
  post("/initiate", body);
export const lock = (intentId: string, stellarTx?: string) => post("/lock", { intentId, stellarTx });
export const settle = (intentId: string): Promise<{ status: string; railTxRef: string; attestation: Attestation }> =>
  post("/settle", { intentId });
export const getIntent = (id: string) => fetch(api(`/intent/${id}`)).then((r) => r.json());
