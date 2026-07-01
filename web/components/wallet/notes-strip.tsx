"use client";

import { useWallet } from "@/components/stellar-wallet-provider";
import { ASSET_SYMBOL } from "@/lib/config";
import { fmt, short } from "@/lib/format";

/**
 * A horizontal strip of the wallet's unspent notes — each rendered as a little
 * UTXO "coin" (value · leaf index · commitment). Makes the shielded balance feel
 * like the bag of notes it actually is. Hidden when there are no spendable notes
 * unless an emptyHint is given.
 */
export function NotesStrip({ title = "Your notes", emptyHint }: { title?: string; emptyHint?: string }) {
  const { wallet } = useWallet();
  const notes = (wallet?.notes ?? []).filter((n) => !n.spent);
  const total = notes.reduce((s, n) => s + BigInt(n.amount), 0n);

  if (notes.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="bg-card border border-border rounded-2xl p-4 text-center text-xs text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-foreground">
          {title} <span className="text-muted-foreground font-normal">({notes.length})</span>
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          spendable {fmt(total)} {ASSET_SYMBOL}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {notes.map((n, i) => (
          <div
            key={i}
            className="shrink-0 min-w-[96px] rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5"
            title={`note · leaf #${n.leafIndex ?? "—"} · key ${n.keyIndex}`}
          >
            <div className="font-sans font-bold text-base tabular-nums text-foreground leading-none">
              {fmt(BigInt(n.amount))}
            </div>
            <div className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              {ASSET_SYMBOL} · leaf #{n.leafIndex ?? "—"}
            </div>
            <div className="text-[8px] font-mono text-muted-foreground/60 truncate">
              {short(BigInt(n.commitment).toString(16), 5)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
