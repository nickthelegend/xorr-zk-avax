"use client";

import { Copy, ShieldCheck } from "lucide-react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { WalletScaffold } from "@/components/wallet/scaffold";
import { Button } from "@/components/ui/button";
import { ASSET_SYMBOL, FUJI, explorerTx } from "@/lib/config";
import { short } from "@/lib/format";
import { toast } from "sonner";

export default function ProfilePage() {
  const {
    address,
    parsedBalance,
    isRegistered,
    keyLoaded,
    isConverter,
    isAuditorKeySet,
    areYouAuditor,
    owner,
  } = useWallet();

  const copy = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    toast.success("Address copied");
  };

  return (
    <WalletScaffold
      eyebrow="Account"
      title="Your XORR profile"
      description="Your confidential account on Avalanche eERC. Balances are decrypted locally with a key derived from your wallet — nothing sensitive ever touches a server."
      flow
    >
      <div className="space-y-4">
        <div className="premium-card p-6">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Encrypted balance · decrypted locally
            </div>
            <ShieldCheck className="size-4 text-primary" />
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-4xl font-bold tracking-tight">{parsedBalance || "0"}</span>
            <span className="mb-1 text-primary/80">{ASSET_SYMBOL}</span>
          </div>
          {address && (
            <button
              onClick={copy}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-muted/50 border border-border px-3 py-1.5 font-mono text-xs text-foreground/80 hover:border-primary/40"
            >
              {short(address, 8)} <Copy className="size-3" />
            </button>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </h3>
          <Row label="Registered" value={isRegistered ? "✓ yes" : "no"} />
          <Row label="Decryption key" value={keyLoaded ? "✓ loaded" : "not set"} />
          <Row label="Token mode" value={isConverter ? "Converter (wrapped)" : "Standalone"} />
          <Row label="Auditor configured" value={isAuditorKeySet ? "✓ yes" : "not yet"} />
          <Row label="You are auditor" value={areYouAuditor ? "✓ yes" : "no"} />
          <Row label="Token owner" value={owner ? short(owner) : "—"} mono />
          <Row label="Network" value={`Avalanche Fuji · ${FUJI.chainId}`} />
        </div>

        {address && (
          <a href={explorerTx("")} target="_blank" rel="noreferrer" className="block">
            <Button variant="outline" className="w-full h-11 text-xs">
              View on Snowtrace ↗
            </Button>
          </a>
        )}
      </div>
    </WalletScaffold>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</span>
    </div>
  );
}
