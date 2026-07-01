"use client";

// Real, on-chain testnet off-ramp via a Stellar SEP-24 anchor. Drives the full
// lifecycle — SEP-10 auth → interactive withdraw form → on-chain payment to the
// anchor → anchor fiat settlement — against the SDF test anchor (no signup/KYC,
// simulated fiat). The same flow points at MoneyGram/Kado in production.
import { useEffect, useState } from "react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Button } from "@/components/ui/button";
import { ExternalLink, Check, Loader2, AlertTriangle } from "lucide-react";
import * as sep24 from "@/lib/sep24";
import { TokenLogo } from "@/components/wallet/fields";
import { ANCHOR_DOMAIN } from "@/lib/config";

type Phase = "idle" | "auth" | "interactive" | "paying" | "anchor" | "done" | "error";
const RUNNING: Phase[] = ["auth", "interactive", "paying", "anchor"];
const expert = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

export function Sep24Offramp() {
  const { address, connect } = useWallet();
  const [asset, setAsset] = useState<sep24.AnchorAsset>(sep24.XLM);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [txn, setTxn] = useState<sep24.Sep24Txn | null>(null);
  const [payHash, setPayHash] = useState("");
  const [popupUrl, setPopupUrl] = useState("");
  const [err, setErr] = useState("");
  const [bal, setBal] = useState<{ balance: string; trusted: boolean } | null>(null);
  const [limits, setLimits] = useState<sep24.AssetLimits | null>(null);
  const [working, setWorking] = useState(false);

  const running = RUNNING.includes(phase);
  const log = (m: string) => setSteps((s) => [...s, m]);

  // Live balance / trustline for the selected asset.
  useEffect(() => {
    if (!address) { setBal(null); return; }
    let on = true;
    sep24.balanceOf(address, asset).then((b) => on && setBal(b)).catch(() => {});
    return () => { on = false; };
  }, [address, asset, phase, working]);

  // Anchor's withdraw min/max/fee for the selected asset.
  useEffect(() => {
    let on = true;
    setLimits(null);
    sep24.fetchWithdrawLimits(asset).then((l) => on && setLimits(l)).catch(() => {});
    return () => { on = false; };
  }, [asset]);

  async function start() {
    if (!address) return;
    setErr(""); setSteps([]); setTxn(null); setPayHash(""); setPopupUrl("");
    try {
      setPhase("auth");
      log(`Authenticating with ${ANCHOR_DOMAIN} (SEP-10)…`);
      const jwt = await sep24.authenticate(address);
      log("Authenticated with the anchor ✓");

      setPhase("interactive");
      const { url, id } = await sep24.startWithdraw(jwt, asset, address, amount || undefined);
      setPopupUrl(url);
      const popup = window.open(url, "xorr_anchor", "popup,width=480,height=720");
      log(popup ? "Opened the anchor's withdrawal form — complete it to continue…"
                : "Popup blocked — open the anchor form with the button below…");

      const ready = await sep24.poll(jwt, id, (t) => t.status === "pending_user_transfer_start", setTxn);
      try { popup?.close(); } catch { /* ignore */ }
      if (ready.status !== "pending_user_transfer_start") throw new Error(`anchor returned "${ready.status}"`);
      log(`Anchor ready — sending ${ready.amount_in} ${asset.label} on-chain…`);

      setPhase("paying");
      const hash = await sep24.sendWithdrawalPayment(address, asset, ready);
      setPayHash(hash);
      log(`On-chain payment to the anchor confirmed ✓`);

      setPhase("anchor");
      log("Anchor settling the fiat payout…");
      const done = await sep24.poll(jwt, id, (t) => t.status === "completed", setTxn);
      if (done.status !== "completed") throw new Error(`settlement ended in "${done.status}"`);
      log(`Off-ramp complete — fiat paid out ✓`);
      setPhase("done");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function addTrustline() {
    if (!address) return;
    setWorking(true); setErr("");
    try { await sep24.establishTrustline(address, asset); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }

  // One-tap deposit (on-ramp) to mint test USDC so the off-ramp has something to send.
  async function getTestUsdc() {
    if (!address) return;
    setWorking(true); setErr("");
    try {
      const jwt = await sep24.authenticate(address);
      if (!(await sep24.balanceOf(address, sep24.ANCHOR_USDC)).trusted) {
        await sep24.establishTrustline(address, sep24.ANCHOR_USDC);
      }
      const { url, id } = await sep24.startDeposit(jwt, sep24.ANCHOR_USDC, address);
      window.open(url, "xorr_anchor_deposit", "popup,width=480,height=720");
      await sep24.poll(jwt, id, (t) => t.status === "completed", undefined, { tries: 120 });
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }

  const needsTrustline = !asset.native && bal != null && !bal.trusted;
  const noBalance = bal != null && Number(bal.balance) <= 0;
  const amtNum = Number(amount);
  const belowMin = limits?.min != null && amtNum > 0 && amtNum < limits.min;
  const aboveMax = limits?.max != null && amtNum > limits.max;
  const outOfRange = Boolean(belowMin || aboveMax);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground text-sm">Live off-ramp · Stellar anchor</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Real SEP-24 withdrawal — settled on-chain on testnet via{" "}
              <span className="font-mono text-primary/80">{ANCHOR_DOMAIN}</span>. No signup, simulated fiat.
            </p>
          </div>
          <span className="text-[9px] font-mono uppercase tracking-wider rounded-full border border-primary/30 text-primary/80 px-2 py-1">SEP-24</span>
        </div>

        {/* Asset selector */}
        <div className="grid grid-cols-2 gap-2">
          {sep24.ASSETS.map((a) => {
            const on = a.code === asset.code;
            return (
              <button key={a.code} type="button" onClick={() => setAsset(a)} disabled={running}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${on ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70"}`}>
                <TokenLogo symbol={a.label} size={18} />
                {a.label}
                {a.native && <span className="ml-1 text-[9px] text-primary/70 uppercase">no setup</span>}
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <div className="rounded-xl bg-muted/40 border border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={running}
              inputMode="decimal"
              placeholder="0.0"
              className="bg-transparent text-2xl font-light outline-none w-full disabled:opacity-60"
            />
            {bal && (
              <button type="button" disabled={running} onClick={() => setAmount(bal.balance)}
                className="shrink-0 text-[11px] text-primary hover:underline disabled:opacity-50">
                Bal {Number(bal.balance).toFixed(2)} {asset.label} · Max
              </button>
            )}
          </div>
        </div>

        {/* Anchor limits + range validation */}
        {limits && (limits.min != null || limits.max != null) && (
          <p className="text-[11px] text-muted-foreground">
            Anchor limits: min {limits.min ?? "—"} · max {limits.max ?? "—"} {asset.label}
            {limits.feePercent ? ` · fee ${limits.feePercent}%` : ""}
            {limits.feeFixed ? ` + ${limits.feeFixed} fixed` : ""}
          </p>
        )}
        {outOfRange && (
          <p className="text-[11px] text-amber-400">
            {aboveMax ? `Max ${limits!.max} ${asset.label} on this test anchor — try a smaller amount.` : `Min ${limits!.min} ${asset.label}.`}
          </p>
        )}

        {/* USDC setup helpers */}
        {needsTrustline && (
          <Button variant="outline" disabled={working} onClick={addTrustline} className="w-full h-10 rounded-xl text-xs">
            {working ? <Loader2 className="size-3.5 animate-spin" /> : null} Add {asset.label} trustline (one-time)
          </Button>
        )}
        {!asset.native && !needsTrustline && noBalance && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-300/90 space-y-2">
            <p>No test {asset.label} to off-ramp yet.</p>
            <Button variant="outline" disabled={working} onClick={getTestUsdc} className="w-full h-9 rounded-lg text-xs">
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null} Get test {asset.label} (anchor deposit)
            </Button>
          </div>
        )}

        {/* Action */}
        {address ? (
          <Button disabled={running || !amount || needsTrustline || noBalance || outOfRange} onClick={start}
            className="w-full h-12 rounded-xl text-sm font-medium">
            {running ? <><Loader2 className="size-4 animate-spin mr-1.5" /> {phaseLabel(phase)}</>
              : `Off-ramp ${amount || "0"} ${asset.label} → fiat`}
          </Button>
        ) : (
          <Button onClick={connect} className="w-full h-12 rounded-xl text-sm font-medium">Connect wallet to off-ramp</Button>
        )}

        {popupUrl && running && (
          <a href={popupUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-[11px] text-primary hover:underline">
            <ExternalLink className="size-3" /> Open the anchor withdrawal form
          </a>
        )}
      </div>

      {/* Live step timeline */}
      {steps.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-2.5">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1;
            const pending = running && isLast;
            return (
              <div key={i} className="flex items-start gap-2.5 text-[12px]">
                <span className="mt-0.5 shrink-0">
                  {pending ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Check className="size-3.5 text-primary" />}
                </span>
                <span className={pending ? "text-foreground" : "text-muted-foreground"}>{s}</span>
              </div>
            );
          })}

          {/* Receipt */}
          {(txn || payHash) && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-[11px] font-mono">
              {txn?.id && <Row k="Anchor txn" v={`${txn.id.slice(0, 12)}…`} />}
              {txn?.amount_in && <Row k="Sent" v={`${txn.amount_in} ${asset.label}`} />}
              {txn?.amount_out && <Row k="Fiat out" v={txn.amount_out} />}
              {txn?.amount_fee && <Row k="Anchor fee" v={txn.amount_fee} />}
              {payHash && <Row k="On-chain tx" v={<a href={expert(payHash)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">{payHash.slice(0, 12)}… <ExternalLink className="size-2.5" /></a>} />}
              {txn?.more_info_url && <Row k="Anchor receipt" v={<a href={txn.more_info_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">view <ExternalLink className="size-2.5" /></a>} />}
            </div>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.07] p-4 text-sm text-primary flex items-center gap-2">
          <Check className="size-4" /> Off-ramp complete — a real SEP-24 withdrawal settled on Stellar testnet.
        </div>
      )}
      {err && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[12px] text-red-300 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> <span>{err}</span>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground text-right">{v}</span>
    </div>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "auth": return "Authenticating…";
    case "interactive": return "Waiting for the anchor form…";
    case "paying": return "Sending on-chain payment…";
    case "anchor": return "Anchor settling…";
    default: return "Working…";
  }
}
