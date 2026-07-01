"use client";

import { type Note } from "@/lib/notes";
import { ASSET_SYMBOL } from "@/lib/config";
import { fmt, short } from "@/lib/format";

/**
 * Manual UTXO note selection — each unspent note is a selectable radio-card
 * (amount · leaf index · commitment). Used by Withdraw and the disclosure flow.
 */
export function NotePicker({
  notes,
  selected,
  onSelect,
}: {
  notes: Note[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="space-y-2 max-h-72 overflow-y-auto no-scrollbar">
      {notes.map((n, i) => {
        const active = i === selected;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              active ? "border-primary/50 bg-primary/10" : "border-border bg-muted/40 hover:bg-muted/70"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`size-4 shrink-0 rounded-full border grid place-items-center ${
                  active ? "border-primary" : "border-muted-foreground/40"
                }`}
              >
                {active && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium tabular-nums text-foreground">
                  {fmt(BigInt(n.amount))} {ASSET_SYMBOL}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate">
                  leaf #{n.leafIndex ?? "—"} · {short(BigInt(n.commitment).toString(16), 6)}
                </div>
              </div>
            </div>
            {active && <span className="text-[10px] font-mono uppercase tracking-wider text-primary shrink-0">selected</span>}
          </button>
        );
      })}
    </div>
  );
}
