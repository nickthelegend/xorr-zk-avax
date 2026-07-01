"use client";

import { type Note } from "@/lib/notes";
import { ASSET_SYMBOL } from "@/lib/config";
import { fmt, short } from "@/lib/format";

export function Constellation({ notes }: { notes: Note[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/70 border border-dashed border-white/10 rounded-2xl p-8 text-center">
        No notes yet — make a deposit to mint your first shielded UTXO.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {notes.map((n, i) => (
        <NoteCard key={i} note={n} />
      ))}
    </div>
  );
}

export function NoteCard({ note: n }: { note: Note }) {
  const active = !n.spent;
  return (
    <div
      className={`relative rounded-2xl border p-4 transition-colors ${
        active ? "border-primary/30 bg-primary/5 hover:border-primary/50" : "border-border bg-muted/40 opacity-60"
      }`}
    >
      <span
        className={`absolute top-3 right-3 font-mono text-[8px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
          active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {active ? "active" : "spent"}
      </span>
      <div className="font-sans font-bold text-xl text-foreground tabular-nums">
        {fmt(BigInt(n.amount))} <span className="text-[10px] text-muted-foreground font-mono">{ASSET_SYMBOL}</span>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground mt-1.5">
        leaf #{n.leafIndex ?? "—"} · key {n.keyIndex}
      </div>
      <div className="font-mono text-[10px] text-muted-foreground/60 truncate">
        {short(BigInt(n.commitment).toString(16), 8)}
      </div>
    </div>
  );
}
