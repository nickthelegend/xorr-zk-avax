"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Copy, Check, LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/components/stellar-wallet-provider";

const NETWORK_LABEL = "FUJI";

const truncate = (addr: string) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "");

export function ConnectWalletButton() {
  const { address, connect, disconnectWallet } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 1500);
  };

  if (!address) {
    return (
      <Button
        onClick={connect}
        variant="outline"
        className="bg-primary/10 border-primary/25 text-primary font-mono text-[10px] tracking-widest uppercase hover:bg-primary/20 rounded-lg px-4 h-9 gap-1.5"
      >
        <Wallet className="size-3.5" />
        Connect wallet
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="flex flex-col items-end gap-1 cursor-pointer group">
          <div className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-1.5 rounded-sm font-mono text-[10px] font-black tracking-tight transition-all active:scale-95 shadow-[0_0_15px_rgba(168,85,247,0.25)]">
            <span className="size-1.5 bg-primary-foreground rounded-full animate-pulse" />
            {truncate(address)}
          </div>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10 text-white font-mono min-w-[280px] p-0 overflow-hidden shadow-2xl">
        <div className="bg-white/5 px-4 py-4 border-b border-white/10 flex flex-col gap-2 relative">
          <div className="absolute top-4 right-4">
            <button onClick={copyAddress} className="text-white/20 hover:text-primary transition-colors">
              {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
            </button>
          </div>
          <span className="text-[8px] text-white/40 uppercase tracking-widest font-bold">Shielded_Session</span>
          <span className="text-[10px] font-bold break-all text-primary/80 pr-6">{address}</span>
        </div>

        <div className="p-3 flex flex-col gap-2">
          <div className="bg-white/5 p-2 rounded-sm border border-white/5 flex justify-between items-center">
            <span className="text-[7px] text-white/30 uppercase">Network</span>
            <span className="text-[9px] font-black text-primary">AVALANCHE_{NETWORK_LABEL}</span>
          </div>
          <DropdownMenuItem
            onClick={copyAddress}
            className="flex items-center justify-center gap-2 py-3 px-3 cursor-pointer text-primary/80 hover:text-primary hover:bg-primary/10 border border-primary/20 text-[10px] uppercase font-black tracking-widest transition-all"
          >
            <Copy className="size-3" />
            COPY_ADDRESS
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={disconnectWallet}
            className="flex items-center justify-center gap-2 py-3 px-3 cursor-pointer text-red-400/80 hover:text-red-400 hover:bg-red-500/10 border border-red-500/20 text-[10px] uppercase font-black tracking-widest transition-all"
          >
            <LogOut className="size-3" />
            Disconnect
          </DropdownMenuItem>
        </div>

        <div className="bg-white/5 px-4 py-2 border-t border-white/10">
          <span className="text-[7px] text-white/20 uppercase tracking-widest">XORR_Terminal // Avalanche_Fuji</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
