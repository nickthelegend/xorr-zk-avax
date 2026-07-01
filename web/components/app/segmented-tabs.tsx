"use client"

// Faithful port of Ghost's app TabSwitcher: a rounded segmented control with a
// sliding pill behind the active tab. Route-aware — each tab is a Link and the
// active one is derived from the current pathname.
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"

export type SegTab = { label: string; href: string }

// The core money-movement flow (XORR's analog of Ghost's Borrow/Lend/Status).
export const MONEY_TABS: SegTab[] = [
  { label: "Deposit", href: "/deposit" },
  { label: "Send", href: "/send" },
  { label: "Swap", href: "/?tab=swap" },
  { label: "Withdraw", href: "/withdraw" },
]

/** State-driven segmented control (Ghost's TabSwitcher) — switches content in-page. */
export function SegmentedControl({
  tabs,
  value,
  onChange,
  layoutId = "seg-pill",
}: {
  tabs: string[];
  value: string;
  onChange: (t: string) => void;
  layoutId?: string;
}) {
  return (
    <div className="flex items-center bg-card border border-border rounded-full p-1">
      {tabs.map((tab) => {
        const active = value === tab;
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`relative flex-1 px-4 sm:px-6 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 bg-muted border border-white/10 rounded-full"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{tab}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedTabs({ tabs, layoutId = "seg-pill" }: { tabs: SegTab[]; layoutId?: string }) {
  const pathname = usePathname()
  const activeHref =
    tabs.find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.href ?? tabs[0].href

  return (
    <div className="flex items-center bg-card border border-border rounded-full p-1">
      {tabs.map((t) => {
        const active = t.href === activeHref
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`relative flex-1 text-center px-6 py-2 rounded-full text-sm font-medium transition-colors ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 bg-muted border border-white/10 rounded-full"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
