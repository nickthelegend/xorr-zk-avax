"use client"

import { Shield, Github } from "lucide-react"

export function AppFooter() {
  return (
    <footer className="w-full flex flex-col md:flex-row justify-between items-center py-6 px-2 md:px-4 border-t border-white/5 gap-6 opacity-50 font-mono">
      <div className="flex items-center gap-6 flex-wrap justify-center">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em]">
          <span className="w-1 h-1 bg-primary rounded-full animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
          XORR_PROTOCOL: ACTIVE
        </div>
        <div className="text-[10px] flex items-center gap-1.5 font-bold uppercase tracking-[0.2em]">
          <Shield className="w-3 h-3" />
          eERC_GROTH16 // AVALANCHE_FUJI
        </div>
      </div>
      <div className="flex gap-6 items-center">
        <span className="text-[10px] font-bold uppercase tracking-widest">Testnet · not audited</span>
        <a
          href="https://github.com/nickthelegend"
          target="_blank"
          rel="noreferrer"
          className="hover:text-primary transition-colors flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
        >
          <Github className="w-3 h-3" /> Source
        </a>
      </div>
    </footer>
  )
}
