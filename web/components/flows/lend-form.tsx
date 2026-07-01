"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as lending from "@/lib/lending";
import type { MarketInfo, Position, Account } from "@/lib/lending";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Button } from "@/components/ui/button";
import { LENDING_ASSETS, lendingEnabled, tokenSymbol, ASSET_DECIMALS } from "@/lib/config";
import { fmt, parseAmount, usdFmt } from "@/lib/format";
import { AmountCard, TokenChip } from "@/components/wallet/fields";

type Action = "supply" | "borrow" | "withdraw" | "repay";
const ACTIONS: { key: Action; label: string }[] = [
  { key: "supply", label: "Supply" },
  { key: "borrow", label: "Borrow" },
  { key: "withdraw", label: "Withdraw" },
  { key: "repay", label: "Repay" },
];
const COLOR: Record<string, string> = { USDC: "#2775ca", XLM: "#7aa2ff", zUSD: "#a78bfa" };
const usd = (v: bigint) => `$${usdFmt(v)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

function healthTone(h: number): { label: string; cls: string } {
  if (h >= 20_000) return { label: "Safe", cls: "text-primary" };
  if (h >= 12_500) return { label: "Healthy", cls: "text-primary" };
  if (h >= 11_000) return { label: "Caution", cls: "text-amber-400" };
  return { label: "At risk", cls: "text-red-400" };
}

export function LendForm({ asset }: { asset: string }) {
  const { address, busy, run, pushLog, connect, refresh } = useWallet();
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const sel = asset;
  const [action, setAction] = useState<Action>("supply");
  const [amt, setAmt] = useState("");
  const [pos, setPos] = useState<Record<string, Position>>({});
  const [acct, setAcct] = useState<Account | null>(null);
  const [wbal, setWbal] = useState<bigint>(0n);
  const [tick, setTick] = useState(0);

  const market = markets.find((m) => m.asset === sel);
  const sym = tokenSymbol(sel);
  const gross = parseAmount(amt);
  const myPos = pos[sel] ?? { supplied: 0n, debt: 0n };

  // Load markets once; positions/account/balance on wallet + tick.
  useEffect(() => {
    if (lendingEnabled()) lending.listMarkets().then(setMarkets).catch(() => setMarkets([]));
  }, [tick]);

  useEffect(() => {
    if (!address || !lendingEnabled()) { setPos({}); setAcct(null); setWbal(0n); return; }
    let live = true;
    (async () => {
      const entries = await Promise.all(
        LENDING_ASSETS.map(async (a) => [a, await lending.position(a, address)] as const),
      );
      if (live) setPos(Object.fromEntries(entries));
      lending.account(address).then((a) => live && setAcct(a)).catch(() => {});
      lending.assetBalance(sel, address).then((b) => live && setWbal(b)).catch(() => {});
    })();
    return () => { live = false; };
  }, [address, sel, tick]);

  // Borrowing power left, expressed in the selected asset's units.
  const borrowableAsset = useMemo(() => {
    if (!acct || !market || market.price === 0n) return 0n;
    const freeUsd = acct.collateralValue > acct.borrowValue ? acct.collateralValue - acct.borrowValue : 0n;
    const byPower = (freeUsd * 10_000_000n) / market.price; // USD7 → asset base units
    return byPower < market.cash ? byPower : market.cash; // capped by available liquidity
  }, [acct, market]);

  const max = useMemo(() => {
    if (action === "supply") return wbal;
    if (action === "withdraw") return myPos.supplied;
    if (action === "repay") return myPos.debt < wbal ? myPos.debt : wbal;
    return borrowableAsset;
  }, [action, wbal, myPos, borrowableAsset]);

  const act = useCallback(async () => {
    if (!address || gross <= 0n) return;
    const fn = lending[action];
    await run(`${ACTIONS.find((a) => a.key === action)!.label} ${amt} ${sym}`, async () => {
      pushLog(`${action} ${amt} ${sym}…`);
      const hash = await fn(address, sel, gross);
      pushLog(`✓ ${action} ${amt} ${sym} · ${hash.slice(0, 8)}`);
    });
    setAmt("");
    setTick((t) => t + 1);
    refresh();
  }, [address, action, sel, gross, amt, sym, run, pushLog, refresh]);

  if (!lendingEnabled()) {
    return <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Lending not configured — set <code>NEXT_PUBLIC_LENDING_ID</code>.</div>;
  }

  const tone = acct ? healthTone(acct.healthBps) : null;
  const healthStr = !acct || acct.borrowValue === 0n ? "∞" : (acct.healthBps / 10_000).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Account health summary */}
      {address && acct && acct.borrowValue > 0n && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Borrow used</span>
            <span>Health factor</span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-sm font-medium">{usd(acct.borrowValue)} <span className="text-muted-foreground">/ {usd(acct.collateralValue)}</span></span>
            <span className={`text-lg font-bold ${tone?.cls}`}>{healthStr} <span className="text-[10px] font-medium">{tone?.label}</span></span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${acct.healthBps < 11_000 ? "bg-red-400" : acct.healthBps < 12_500 ? "bg-amber-400" : "bg-primary"}`}
              style={{ width: `${Math.min(100, acct.collateralValue > 0n ? Number((acct.borrowValue * 100n) / acct.collateralValue) : 0)}%` }} />
          </div>
        </div>
      )}

      {/* Selected market (chosen from the Markets list on the left) */}
      {market && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
          <TokenChip symbol={sym} color={COLOR[sym] ?? "#888"} />
          <span className="text-[10px] font-medium text-muted-foreground rounded-full border border-border px-2.5 py-1">
            {market.collateralFactor / 100}% max LTV
          </span>
        </div>
      )}

      {/* Action segmented control */}
      <div className="flex rounded-xl border border-border bg-muted/40 p-1">
        {ACTIONS.map((a) => (
          <button key={a.key} onClick={() => { setAction(a.key); setAmt(""); }}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${action === a.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {a.label}
          </button>
        ))}
      </div>

      {/* Amount + max */}
      <AmountCard
        label={`${ACTIONS.find((a) => a.key === action)!.label} · ${sym}`}
        token={<TokenChip symbol={sym} color={COLOR[sym] ?? "#888"} />}
        value={amt}
        onChange={setAmt}
        right={<button type="button" onClick={() => setAmt((Number(max) / 10 ** ASSET_DECIMALS).toString())} className="text-[11px] text-primary hover:underline">Max {fmt(max)}</button>}
        footer={address
          ? <span className="text-[11px] text-muted-foreground">supplied <b className="text-foreground">{fmt(myPos.supplied)}</b> · debt <b className="text-foreground">{fmt(myPos.debt)}</b> {sym}</span>
          : <button onClick={connect} className="text-[11px] text-primary hover:underline">Connect wallet</button>}
      />

      {/* Market stats */}
      {market && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { k: "Supply APY", v: pct(market.supplyApyBps) },
            { k: "Borrow APY", v: pct(market.borrowApyBps) },
            { k: "Utilization", v: pct(market.utilizationBps) },
          ].map((s) => (
            <div key={s.k} className="rounded-xl border border-border bg-muted/40 p-2.5 text-center">
              <div className="text-sm font-semibold">{s.v}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.k}</div>
            </div>
          ))}
        </div>
      )}

      <Button disabled={!address || busy || gross <= 0n} onClick={act} className="w-full h-12 rounded-xl text-sm font-medium">
        {busy ? "Submitting…" : !address ? "Connect wallet first" : `${ACTIONS.find((a) => a.key === action)!.label} ${amt || "0"} ${sym}`}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        {action === "borrow" ? "Borrow against your supplied collateral. Keep health ≥ 1.0 to avoid liquidation."
          : action === "supply" ? "Supplied assets earn interest and count as collateral."
          : action === "withdraw" ? "Withdraw is blocked if it would drop your health below 1.0."
          : "Repay reduces your debt and frees collateral."}
      </p>
    </div>
  );
}
