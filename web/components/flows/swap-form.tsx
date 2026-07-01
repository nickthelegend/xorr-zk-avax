"use client";

import { useEffect, useMemo, useState } from "react";
import * as pools from "@/lib/pools";
import * as pool from "@/lib/pool";
import type { PoolInfo } from "@/lib/pools";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Banner } from "@/components/wallet/scaffold";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  poolsEnabled, swapEnabled, SWAP_TOKEN_A, SWAP_TOKEN_A_SYMBOL, SWAP_TOKEN_B_SYMBOL, SHIELDED_SYMBOL, tokenSymbol,
} from "@/lib/config";
import { fmt, parseAmount, short } from "@/lib/format";
import { AmountCard, TokenChip, SwapDivider } from "@/components/wallet/fields";
import { toast } from "sonner";

const labelCls = "font-mono text-[10px] uppercase tracking-wider text-muted-foreground";
const sym = (a: string) => tokenSymbol(a);
type Mode = "public" | "private";

export function SwapForm() {
  const { address, wallet, balance, busy, run, pushLog } = useWallet();
  const [mode, setMode] = useState<Mode>("public");
  const [poolList, setPoolList] = useState<PoolInfo[]>([]);
  const [poolId, setPoolId] = useState(0);
  const [dir, setDir] = useState<"AtoB" | "BtoA">("AtoB");
  const [amt, setAmt] = useState("");
  const [out, setOut] = useState<bigint | null>(null);
  const [slippage, setSlippage] = useState("1.0");

  const zk = mode === "private";
  const pinfo = poolList.find((p) => p.id === poolId) ?? null;
  const effPoolId = zk ? 0 : poolId; // private swap routes through the AMM venue (pool 0)
  const inAddr = zk ? SWAP_TOKEN_A : pinfo ? (dir === "AtoB" ? pinfo.tokenA : pinfo.tokenB) : SWAP_TOKEN_A;
  const inSym = zk ? SHIELDED_SYMBOL : pinfo ? sym(inAddr) : SWAP_TOKEN_A_SYMBOL;
  const outSym = zk ? SWAP_TOKEN_B_SYMBOL : pinfo ? sym(dir === "AtoB" ? pinfo.tokenB : pinfo.tokenA) : SWAP_TOKEN_B_SYMBOL;

  const shieldedNote = useMemo(
    () => (wallet?.notes ?? []).find((n) => !n.spent && n.leafIndex != null && BigInt(n.amount) >= parseAmount(amt)),
    [wallet, amt],
  );

  useEffect(() => {
    if (poolsEnabled()) pools.listPools().then(setPoolList).catch(() => setPoolList([]));
  }, []);

  // live quote (both modes price through the on-chain AMM)
  useEffect(() => {
    const v = parseAmount(amt);
    if (!poolsEnabled() || v <= 0n) { setOut(null); return; }
    let live = true;
    const t = setTimeout(() => {
      pools.quote(effPoolId, inAddr, v).then((o) => live && setOut(o)).catch(() => live && setOut(null));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [amt, inAddr, effPoolId]);

  const setModeReset = (m: Mode) => { setMode(m); setOut(null); setAmt(""); };

  const submit = () => {
    const v = parseAmount(amt);
    const slipBps = Math.round(parseFloat(slippage || "1") * 100);
    const minOut = out ? (out * BigInt(10000 - slipBps)) / 10000n : 0n;

    if (zk) {
      if (!shieldedNote) { toast.error(`No shielded ${SHIELDED_SYMBOL} note ≥ amount — deposit first`); return; }
      run(`Private ZK swap ${amt} ${SHIELDED_SYMBOL} → ${outSym}`, async () => {
        const { amountOut } = await pool.privateSwap(address!, wallet!, shieldedNote, address!, v, minOut, pushLog);
        pushLog(`🔒 ZK swap → ${fmt(amountOut)} ${outSym} (no account link)`);
      });
      return;
    }
    run(`Swapping ${amt} ${inSym} → ${outSym}`, async () => {
      const hash = await pools.swap(address!, effPoolId, inAddr, v, minOut);
      pushLog(`Swapped ${amt} ${inSym} → ~${fmt(out ?? 0n)} ${outSym} · ${short(hash)}`);
      pools.listPools().then(setPoolList).catch(() => {});
    });
  };

  if (!poolsEnabled() && !swapEnabled()) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <Banner tone="warn">Swaps not configured — set <code>NEXT_PUBLIC_POOL_FACTORY_ID</code>.</Banner>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
      {/* Public / Private sub-tabs */}
      <div className="flex rounded-xl border border-border bg-muted/40 p-1">
        {([
          { k: "public" as Mode, label: "Public", hint: "AMM swap" },
          { k: "private" as Mode, label: "🔒 Private", hint: "ZK · no link" },
        ]).map((t) => (
          <button
            key={t.k}
            onClick={() => setModeReset(t.k)}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${mode === t.k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
            <span className="block text-[9px] font-normal opacity-70">{t.hint}</span>
          </button>
        ))}
      </div>

      {/* Public: pool picker */}
      {!zk && (
        <div className="flex items-center gap-2">
          <Label className={labelCls}>Pool</Label>
          <select
            value={poolId}
            onChange={(e) => { setPoolId(Number(e.target.value)); setOut(null); }}
            className="h-9 flex-1 rounded-md bg-muted/50 border border-border px-2 text-sm"
          >
            {poolList.map((p) => (
              <option key={p.id} value={p.id}>#{p.id} {sym(p.tokenA)}/{sym(p.tokenB)} {p.confidential ? "🔒" : ""}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <AmountCard
          label="You pay"
          right={zk ? <span className="text-[10px] text-muted-foreground">shielded: {fmt(balance)} {SHIELDED_SYMBOL}</span> : undefined}
          token={<TokenChip symbol={inSym} primary={zk} color="#2775ca" />}
          value={amt}
          onChange={setAmt}
          placeholder="0.0"
        />
        <SwapDivider onClick={!zk ? () => { setDir((d) => (d === "AtoB" ? "BtoA" : "AtoB")); setOut(null); } : undefined} />
        <AmountCard
          accent
          label="You receive"
          token={<TokenChip symbol={outSym} />}
          value={out != null ? fmt(out) : ""}
          placeholder="—"
          readOnly
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{zk ? "spends a shielded note · output to your wallet" : "public constant-product AMM"}</span>
        <span className="flex items-center gap-1">
          slippage
          <Input value={slippage} onChange={(e) => setSlippage(e.target.value)} className="h-7 w-14 bg-muted/50 border-border text-center" />%
        </span>
      </div>

      <Button
        disabled={busy || !address || parseAmount(amt) <= 0n || out == null || (zk && !shieldedNote)}
        onClick={submit}
        className="w-full h-12 rounded-xl text-sm font-medium"
      >
        {busy ? (zk ? "Proving & swapping…" : "Swapping…") : zk ? `🔒 ZK swap ${inSym} → ${outSym}` : `Swap ${inSym} → ${outSym}`}
      </Button>
      {!address && <p className="text-[11px] text-muted-foreground">Connect a wallet (or sign in) to swap.</p>}
      {zk && !shieldedNote && parseAmount(amt) > 0n && (
        <p className="text-[11px] text-amber-400/90">No shielded note ≥ {amt} {SHIELDED_SYMBOL} — deposit first.</p>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
        {zk ? (
          <><b className="text-foreground">Private swap:</b> a Groth16 proof spends a shielded {SHIELDED_SYMBOL} note (note ∈ Merkle tree, nullifier valid) and routes it through the AMM — the trade has <b>no on-chain link</b> to your identity or balance.</>
        ) : (
          <><b className="text-foreground">Public swap:</b> a standard constant-product AMM swap on Soroban. Pick any pool, including confidential ones. Switch to Private to spend from your shielded balance with no account link.</>
        )}
      </p>
    </div>
  );
}
