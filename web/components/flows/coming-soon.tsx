"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

// Premium "on the roadmap" panel for features carried over from the Stellar
// build that don't yet have a 1:1 eERC mapping (swaps, bridge, off-ramp,
// solvency). Keeps the UI intact without wiring Stellar-only logic.
export function ComingSoon({
  title,
  points,
  note,
}: {
  title: string;
  points: ReactNode[];
  note?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="premium-card p-8 text-center"
    >
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 border border-primary/20 text-primary">
        <Sparkles className="size-5" />
      </div>
      <span className="inline-flex items-center font-mono text-[10px] tracking-[0.25em] text-primary uppercase bg-primary/10 border border-primary/20 px-3 py-1 rounded-full">
        On the roadmap
      </span>
      <h3 className="mt-4 text-xl font-semibold text-foreground">{title}</h3>
      <ul className="mt-4 mx-auto max-w-md space-y-2 text-left">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="mt-1.5 size-1.5 rounded-full bg-primary/60 shrink-0" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {note && (
        <p className="mt-5 text-xs text-muted-foreground/80 leading-relaxed max-w-md mx-auto">
          {note}
        </p>
      )}
    </motion.div>
  );
}
