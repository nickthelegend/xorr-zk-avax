"use client"

import { useState, useRef, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { ChevronDown, ArrowUpRight, Menu, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button"
import { ChainSwitch } from "@/components/wallet/chain-switch"
import { SignInButton } from "@/components/auth/sign-in-button"

const NAV = [
  { label: "Home", href: "/" },
  { label: "Markets", href: "/explore" },
  { label: "Profile", href: "/profile" },
]

const MORE = [
  { label: "Withdraw", href: "/withdraw", desc: "Burn confidential xUSD (hidden amount)" },
  { label: "Faucet", href: "/faucet", desc: "Get Fuji AVAX + mint test xUSD" },
  { label: "Compliance", href: "/compliance", desc: "Auditor & selective disclosure" },
  { label: "Proof of Solvency", href: "/solvency", desc: "Prove balance ≥ threshold, amount hidden" },
  { label: "Claim", href: "/claim", desc: "Claim a payment sent to you" },
  { label: "Off-ramp", href: "/offramp", desc: "Private fiat off-ramp corridor" },
]

const springSnappy = { type: "spring" as const, stiffness: 400, damping: 28 }
const isActive = (p: string, href: string) => (href === "/" ? p === "/" : p.startsWith(href))

export function AppHeader() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMore = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setMoreOpen(true)
  }, [])
  const closeMore = useCallback(() => {
    closeTimer.current = setTimeout(() => setMoreOpen(false), 180)
  }, [])

  const moreActive = MORE.some((m) => isActive(pathname, m.href))

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#101010]/70 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-7">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo.png" alt="XORR" width={92} height={28} className="h-7 w-auto" priority />
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-0.5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-4 py-2 text-sm font-medium rounded-full transition-colors duration-150 ${
                  active ? "text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {active && (
                  <motion.div layoutId="nav-pill" className="absolute inset-0 bg-white/10 rounded-full" transition={springSnappy} />
                )}
                <span className="relative z-10">{item.label}</span>
              </Link>
            )
          })}

          {/* More dropdown */}
          <div className="relative" onMouseEnter={openMore} onMouseLeave={closeMore}>
            <button
              className={`relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-colors duration-150 ${
                moreActive || moreOpen ? "text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {moreActive && (
                <motion.div layoutId="nav-pill" className="absolute inset-0 bg-white/10 rounded-full" transition={springSnappy} />
              )}
              <span className="relative z-10">More</span>
              <ChevronDown className={`w-3.5 h-3.5 relative z-10 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {moreOpen && (
                <div className="absolute top-full right-0 pt-3">
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    className="w-[300px] rounded-2xl border border-white/10 bg-[#1a1a1a] shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)] p-2"
                  >
                    {MORE.map((m) => {
                      const active = isActive(pathname, m.href)
                      return (
                        <Link
                          key={m.href}
                          href={m.href}
                          className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors group ${
                            active ? "bg-white/[0.06]" : "hover:bg-white/[0.06]"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold ${active ? "text-primary" : "text-white"}`}>{m.label}</div>
                            <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                        </Link>
                      )
                    })}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right: chain guard + auth + wallet */}
        <div className="hidden md:flex items-center gap-2 ml-auto">
          <ChainSwitch />
          <SignInButton />
          <ConnectWalletButton />
        </div>

        {/* Mobile toggle */}
        <button onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu" className="md:hidden ml-auto p-2 text-gray-400">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden bg-[#1a1a1a] border-t border-white/[0.06] overflow-hidden"
          >
            <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block text-sm font-semibold py-1.5 ${isActive(pathname, item.href) ? "text-primary" : "text-white"}`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-gray-500 mb-1.5">More</div>
                <div className="space-y-0.5">
                  {MORE.map((m) => (
                    <Link
                      key={m.href}
                      href={m.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block text-sm py-1.5 ${isActive(pathname, m.href) ? "text-primary" : "text-gray-400"}`}
                    >
                      {m.label}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-3 border-t border-white/[0.06]">
                <ChainSwitch />
                <SignInButton />
                <ConnectWalletButton />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
