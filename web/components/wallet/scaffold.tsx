"use client";

import { type ReactNode } from "react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { ASSET_SYMBOL, isConfigured } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SegmentedTabs, type SegTab } from "@/components/app/segmented-tabs";

/* ── Page header ──────────────────────────────────────────────────────── */
export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="mb-8 halo">
      <span className="inline-flex items-center font-mono text-[10px] tracking-[0.25em] text-primary uppercase bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full">
        {eyebrow}
      </span>
      <h1 className="font-display font-bold text-4xl md:text-5xl tracking-tight mt-4 text-gradient leading-[1.05]">
        {title}
      </h1>
      <p className="text-muted-foreground text-sm md:text-base max-w-2xl mt-3 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

/* ── Connect nudge ────────────────────────────────────────────────────── */
export function ConnectNudge() {
  const { connect } = useWallet();
  return (
    <div className="bg-card border border-border rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h3 className="font-semibold text-foreground">Connect your wallet to act</h3>
        <p className="text-sm text-muted-foreground mt-1">
          eERC runs all cryptography client-side; signing a confidential action needs your Avalanche wallet on Fuji.
        </p>
      </div>
      <Button onClick={connect} className="font-mono text-[11px] uppercase tracking-widest shrink-0">
        Connect wallet
      </Button>
    </div>
  );
}

/* ── Banners ──────────────────────────────────────────────────────────── */
export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "ok";
  children: ReactNode;
}) {
  const tones = {
    info: "border-sky-400/20 bg-sky-400/5 text-sky-200/90",
    warn: "border-amber-400/20 bg-amber-400/5 text-amber-200/90",
    ok: "border-primary/25 bg-primary/5 text-primary",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-xs leading-relaxed", tones[tone])}>
      {children}
    </div>
  );
}

/* ── Activity panel (busy shimmer + log feed) ─────────────────────────── */
export function ActivityPanel() {
  const { log, busy, busyMsg } = useWallet();
  return (
    <div className="bg-card border border-border rounded-2xl p-5 lg:sticky lg:top-28">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Activity
        </h3>
        {busy && <span className="size-2 rounded-full bg-primary animate-pulse" />}
      </div>
      {busy && (
        <div className="flex items-center gap-2 mb-3 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
          <span className="size-2 rounded-full bg-primary animate-ping" />
          <span className="text-xs text-primary font-mono animate-pulse">{busyMsg}…</span>
        </div>
      )}
      {log.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">
          No activity yet. Connect &amp; make a deposit.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto no-scrollbar">
          {log.map((l, i) => (
            <div
              key={i}
              className="text-[11px] font-mono text-foreground/70 leading-snug border-b border-white/5 pb-1.5 last:border-0"
            >
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Full page scaffold: header + (main | activity aside) ─────────────── */
export function WalletScaffold({
  eyebrow,
  title,
  description,
  children,
  requireConnect = true,
  tabs,
  flow,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
  requireConnect?: boolean;
  tabs?: SegTab[];
  flow?: boolean;
}) {
  const { ready, address, proofReady, busy, log } = useWallet();

  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-10">
            <span className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
          </div>
          <span className="text-muted-foreground font-mono text-xs tracking-wide">
            initializing zero-knowledge wallet…
          </span>
        </div>
      </div>
    );
  }

  const extras = (
    <>
      {!isConfigured() && (
        <Banner tone="warn">
          eERC not configured — set <code>NEXT_PUBLIC_EERC_ADDRESS</code> in{" "}
          <code>web/.env.local</code> to your deployed EncryptedERC address (run{" "}
          <code>contracts/scripts/deploy-xorr.ts</code>).
        </Banner>
      )}
      {isConfigured() && address && !proofReady && (
        <Banner tone="info">
          Initializing the proving system &amp; loading circuits…
        </Banner>
      )}
      {requireConnect && !address && <ConnectNudge />}
    </>
  );

  // Ghost-app flow mode: centered narrow column with a segmented tab control,
  // a clean heading, the form card, and the activity feed only while it matters.
  if (tabs || flow) {
    return (
      <div className="w-full max-w-xl mx-auto pt-4 pb-10 space-y-6">
        {tabs && <SegmentedTabs tabs={tabs} />}
        <div className="space-y-2">
          <h1 className="text-2xl font-medium text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
        {extras}
        {children}
        {(busy || log.length > 0) && <ActivityPanel />}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pt-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-5">
          {extras}
          {children}
        </div>
        <aside>
          <ActivityPanel />
        </aside>
      </div>
    </div>
  );
}

export { ASSET_SYMBOL };
