// Real SEP-24 on/off-ramp client against a Stellar anchor (defaults to the SDF
// reference test anchor — genuine SEP-10 + SEP-24 on Stellar testnet, settled
// on-chain, with simulated "fake banking" fiat rails: no signup, no KYC, no real
// money). Hand-rolled over fetch + @stellar/stellar-sdk (no new deps), signed by
// the app's connected wallet. Point ANCHOR_DOMAIN at MoneyGram/Kado for prod.
//
// Off-ramp (withdraw) lifecycle:
//   authenticate (SEP-10)  -> JWT
//   startWithdraw (SEP-24) -> { interactive url, txn id }   [open the popup]
//   poll until pending_user_transfer_start (anchor returns its receive account)
//   sendWithdrawalPayment  -> classic Stellar payment to the anchor (+ memo)
//   poll until completed    (anchor "pays out" the fiat)
import { Horizon, TransactionBuilder, Operation, Asset, Memo } from "@stellar/stellar-sdk";
import { ANCHOR_DOMAIN, HORIZON_URL, NETWORK_PASSPHRASE, ANCHOR_USDC_ISSUER } from "./config";
import { signXdr, notifyTx } from "./stellar";

const AUTH = `https://${ANCHOR_DOMAIN}/auth`;
const SEP24 = `https://${ANCHOR_DOMAIN}/sep24`;
const FEE = "100000"; // 0.01 XLM headroom for classic ops on testnet
const horizon = () => new Horizon.Server(HORIZON_URL);

export interface AnchorAsset { code: string; issuer?: string; native: boolean; label: string }
export const XLM: AnchorAsset = { code: "native", native: true, label: "XLM" };
export const ANCHOR_USDC: AnchorAsset = { code: "USDC", issuer: ANCHOR_USDC_ISSUER, native: false, label: "USDC" };
export const ASSETS: AnchorAsset[] = [XLM, ANCHOR_USDC];

const sdkAsset = (a: AnchorAsset) => (a.native ? Asset.native() : new Asset(a.code, a.issuer!));

export interface Sep24Txn {
  id: string;
  status: string;
  status_eta?: number;
  more_info_url?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
  stellar_transaction_id?: string;
}

export const ANCHOR = ANCHOR_DOMAIN;

// --- SEP-10: get a JWT by signing the anchor's challenge transaction ----------
export async function authenticate(account: string): Promise<string> {
  const r = await fetch(`${AUTH}?account=${encodeURIComponent(account)}`);
  if (!r.ok) throw new Error(`SEP-10 challenge failed (${r.status})`);
  const ch = await r.json();
  if (!ch.transaction) throw new Error(ch.error || "no SEP-10 challenge returned");
  const signed = await signXdr(ch.transaction);
  const v = await fetch(AUTH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: signed }),
  });
  const j = await v.json();
  if (!j.token) throw new Error(j.error || "SEP-10 verification failed");
  return j.token as string;
}

function interactiveBody(asset: AnchorAsset, account: string, amount?: string): Record<string, string> {
  const body: Record<string, string> = { asset_code: asset.code, account };
  if (asset.issuer) body.asset_issuer = asset.issuer;
  if (amount) body.amount = amount;
  return body;
}

// --- SEP-24: start an interactive withdraw (off-ramp) -------------------------
export async function startWithdraw(jwt: string, asset: AnchorAsset, account: string, amount?: string): Promise<{ url: string; id: string }> {
  const r = await fetch(`${SEP24}/transactions/withdraw/interactive`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify(interactiveBody(asset, account, amount)),
  });
  const j = await r.json();
  if (!j.url || !j.id) throw new Error(j.error || `withdraw init failed (${r.status})`);
  return { url: j.url, id: j.id };
}

// --- SEP-24: start an interactive deposit (on-ramp; fetch test USDC to demo) ---
export async function startDeposit(jwt: string, asset: AnchorAsset, account: string): Promise<{ url: string; id: string }> {
  const r = await fetch(`${SEP24}/transactions/deposit/interactive`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify(interactiveBody(asset, account)),
  });
  const j = await r.json();
  if (!j.url || !j.id) throw new Error(j.error || `deposit init failed (${r.status})`);
  return { url: j.url, id: j.id };
}

export interface AssetLimits { enabled: boolean; min?: number; max?: number; feeFixed?: number; feePercent?: number }

/** Per-asset withdraw min/max/fee from the anchor's SEP-24 /info (no auth). */
export async function fetchWithdrawLimits(asset: AnchorAsset): Promise<AssetLimits> {
  try {
    const j = await (await fetch(`${SEP24}/info`)).json();
    const w = j.withdraw?.[asset.code] ?? {};
    return { enabled: Boolean(w.enabled), min: w.min_amount, max: w.max_amount, feeFixed: w.fee_fixed, feePercent: w.fee_percent };
  } catch {
    return { enabled: true };
  }
}

export async function getTransaction(jwt: string, id: string): Promise<Sep24Txn> {
  const r = await fetch(`${SEP24}/transaction?id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  const j = await r.json();
  if (!j.transaction) throw new Error(j.error || "transaction not found");
  return j.transaction;
}

const TERMINAL = new Set(["completed", "refunded", "error", "expired"]);

/** Poll the anchor until `want(txn)` is true or the txn reaches a terminal state. */
export async function poll(
  jwt: string,
  id: string,
  want: (t: Sep24Txn) => boolean,
  onUpdate?: (t: Sep24Txn) => void,
  opts: { interval?: number; tries?: number } = {},
): Promise<Sep24Txn> {
  const { interval = 3000, tries = 100 } = opts;
  let last: Sep24Txn | null = null;
  for (let i = 0; i < tries; i++) {
    const t = await getTransaction(jwt, id);
    if (!last || last.status !== t.status) onUpdate?.(t);
    last = t;
    if (want(t) || TERMINAL.has(t.status)) return t;
    await new Promise((res) => setTimeout(res, interval));
  }
  throw new Error("timed out waiting for the anchor");
}

function memoFor(t: Sep24Txn): Memo | undefined {
  if (!t.withdraw_memo) return undefined;
  switch (t.withdraw_memo_type) {
    case "id": return Memo.id(t.withdraw_memo);
    case "hash": return Memo.hash(Buffer.from(t.withdraw_memo, "base64"));
    default: return Memo.text(t.withdraw_memo);
  }
}

// --- Send the on-chain withdrawal payment to the anchor (classic payment) ------
export async function sendWithdrawalPayment(from: string, asset: AnchorAsset, t: Sep24Txn): Promise<string> {
  if (!t.withdraw_anchor_account || !t.amount_in) {
    throw new Error("anchor has not provided payment instructions yet");
  }
  const h = horizon();
  const acct = await h.loadAccount(from);
  const builder = new TransactionBuilder(acct, { fee: FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.payment({ destination: t.withdraw_anchor_account, asset: sdkAsset(asset), amount: t.amount_in }));
  const memo = memoFor(t);
  if (memo) builder.addMemo(memo);
  const tx = builder.setTimeout(180).build();
  const signed = await signXdr(tx.toXDR());
  const res = await h.submitTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE) as any);
  notifyTx(res.hash, "Off-ramp payment");
  return res.hash;
}

// --- Trustline + balance helpers (USDC needs a trustline; XLM does not) --------
export async function balanceOf(account: string, asset: AnchorAsset): Promise<{ balance: string; trusted: boolean }> {
  try {
    const acct = await horizon().loadAccount(account);
    if (asset.native) {
      const b = acct.balances.find((x: any) => x.asset_type === "native");
      return { balance: b?.balance ?? "0", trusted: true };
    }
    const b = acct.balances.find((x: any) => x.asset_code === asset.code && x.asset_issuer === asset.issuer);
    return { balance: b?.balance ?? "0", trusted: Boolean(b) };
  } catch {
    return { balance: "0", trusted: asset.native };
  }
}

export async function establishTrustline(from: string, asset: AnchorAsset): Promise<string> {
  if (asset.native) return "";
  const h = horizon();
  const acct = await h.loadAccount(from);
  const tx = new TransactionBuilder(acct, { fee: FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: sdkAsset(asset) }))
    .setTimeout(120)
    .build();
  const signed = await signXdr(tx.toXDR());
  const res = await h.submitTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE) as any);
  notifyTx(res.hash, "Trustline");
  return res.hash;
}
