"use client";

// Fuji network guard. XORR's eERC contracts live on the Avalanche Fuji C-Chain
// (43113); if the connected wallet is on any other network, registration/mint/
// transfer can't work. This header pill surfaces the wallet's current chain and,
// when it's wrong, switches it to Fuji in one click. Renders nothing until a
// wallet is connected.
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { toast } from "sonner";

export function ChainSwitch() {
  const [mounted, setMounted] = useState(false);
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  useEffect(() => setMounted(true), []);
  if (!mounted || !isConnected) return null;

  const onFuji = chainId === avalancheFuji.id;

  if (onFuji) {
    return (
      <div
        title="Avalanche Fuji C-Chain (43113)"
        className="hidden sm:flex items-center gap-1.5 h-9 rounded-lg px-3 bg-white/5 border border-white/10 text-gray-300 font-mono text-[10px] tracking-widest uppercase select-none"
      >
        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Fuji
      </div>
    );
  }

  return (
    <button
      onClick={() =>
        switchChain(
          { chainId: avalancheFuji.id },
          { onError: (e) => toast.error("Couldn't switch network", { description: e.message.slice(0, 140) }) },
        )
      }
      disabled={isPending}
      title="Your wallet is on the wrong network — switch to Avalanche Fuji"
      className="flex items-center gap-1.5 h-9 rounded-lg px-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 font-mono text-[10px] tracking-widest uppercase transition-colors disabled:opacity-60"
    >
      <span className="size-1.5 rounded-full bg-[color:var(--color-avax,#e84142)]" />
      {isPending ? "Switching…" : "Switch to Fuji"}
    </button>
  );
}
