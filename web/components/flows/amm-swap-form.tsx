"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { AmountCard, TokenChip } from "@/components/wallet/fields";
import { Banner } from "@/components/wallet/scaffold";
import { RegisterGate } from "@/components/wallet/register-gate";
import { DEFI, ERC20_ABI, AMM_ABI } from "@/lib/defi";
import { explorerTx } from "@/lib/config";
import { toast } from "sonner";

const toUnits = (s: string) => BigInt(Math.round((Number(s) || 0) * 100));
const fmt = (v?: bigint) => (v === undefined ? "—" : (Number(v) / 100).toFixed(2));

// Real public swap on the XorrAMM (USDC ↔ XAV) via wagmi. A confidential swap
// additionally burns eERC xUSD and lets a relayer route the output to a fresh
// address (see the contracts + relayer script); this tab covers the public leg.
export function AmmSwapForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [fromUsdc, setFromUsdc] = useState(true);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const tokenIn = fromUsdc ? DEFI.usdc : DEFI.xav;
  const symIn = fromUsdc ? "USDC" : "XAV";
  const symOut = fromUsdc ? "XAV" : "USDC";
  const amountIn = toUnits(amt);

  const usdcBal = useReadContract({
    address: DEFI.usdc, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 5000 },
  });
  const xavBal = useReadContract({
    address: DEFI.xav, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 5000 },
  });
  const quoted = useReadContract({
    address: DEFI.amm, abi: AMM_ABI, functionName: "quote",
    args: [tokenIn, amountIn], query: { enabled: amountIn > 0n },
  });

  const balIn = fromUsdc ? usdcBal.data : xavBal.data;
  const out = quoted.data as bigint | undefined;

  async function tokenFaucet() {
    if (!address) return;
    setBusy(true);
    try {
      for (const t of [DEFI.usdc, DEFI.xav]) {
        const h = await writeContractAsync({ address: t, abi: ERC20_ABI, functionName: "mint", args: [address, 100000n] });
        await publicClient!.waitForTransactionReceipt({ hash: h });
      }
      toast.success("Minted 1000 USDC + 1000 XAV");
      usdcBal.refetch(); xavBal.refetch();
    } catch (e) { toast.error((e as Error).message.slice(0, 120)); }
    finally { setBusy(false); }
  }

  async function swap() {
    if (!address || amountIn <= 0n) return;
    if (balIn !== undefined && amountIn > (balIn as bigint)) return toast.error(`Insufficient ${symIn}`);
    setBusy(true);
    try {
      // approve if needed
      const allowance = (await publicClient!.readContract({
        address: tokenIn, abi: ERC20_ABI, functionName: "allowance", args: [address, DEFI.amm],
      })) as bigint;
      if (allowance < amountIn) {
        const ah = await writeContractAsync({ address: tokenIn, abi: ERC20_ABI, functionName: "approve", args: [DEFI.amm, amountIn] });
        await publicClient!.waitForTransactionReceipt({ hash: ah });
      }
      const minOut = out ? (out * 98n) / 100n : 0n; // 2% slippage
      const sh = await writeContractAsync({
        address: DEFI.amm, abi: AMM_ABI, functionName: "swap", args: [tokenIn, amountIn, minOut, address],
      });
      await publicClient!.waitForTransactionReceipt({ hash: sh });
      toast.success(`Swapped ${amt} ${symIn} → ${symOut}`, {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(sh), "_blank") },
      });
      setAmt(""); usdcBal.refetch(); xavBal.refetch();
    } catch (e) { toast.error((e as Error).message.slice(0, 140)); }
    finally { setBusy(false); }
  }

  return (
    <RegisterGate>
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Balances: <b className="text-foreground">{fmt(usdcBal.data as bigint)}</b> USDC · <b className="text-foreground">{fmt(xavBal.data as bigint)}</b> XAV</span>
            <button onClick={tokenFaucet} disabled={busy} className="text-primary hover:underline disabled:opacity-50">+ mint test tokens</button>
          </div>

          <AmountCard
            label={`You pay (${symIn})`}
            token={<TokenChip symbol={symIn} primary />}
            value={amt}
            onChange={setAmt}
            placeholder="0.0"
            right={<button onClick={() => setFromUsdc(!fromUsdc)} className="text-[11px] text-primary hover:underline">⇅ flip to {symOut}</button>}
          />

          <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">You receive ({symOut})</span>
            <span className="text-lg font-semibold tabular-nums">{amountIn > 0n ? fmt(out) : "0.00"}</span>
          </div>

          <Button disabled={busy || amountIn <= 0n || !address} onClick={swap} className="w-full h-12 rounded-xl">
            {busy ? "Swapping…" : `Swap ${symIn} → ${symOut}`}
          </Button>

          <Banner tone="info">
            Public constant-product swap (0.3% fee) on the XorrAMM. For a{" "}
            <b>confidential</b> swap, xUSD is burned on the eERC and a relayer
            routes the output to a fresh address — see the tested contracts.
          </Banner>
        </div>
      </div>
    </RegisterGate>
  );
}
