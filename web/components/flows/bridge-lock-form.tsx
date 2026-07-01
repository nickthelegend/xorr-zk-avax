"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AmountCard, TokenChip } from "@/components/wallet/fields";
import { Banner } from "@/components/wallet/scaffold";
import { RegisterGate } from "@/components/wallet/register-gate";
import { DEFI, ERC20_ABI, BRIDGE_ABI } from "@/lib/defi";
import { explorerTx } from "@/lib/config";
import { toast } from "sonner";

const toUnits = (s: string) => BigInt(Math.round((Number(s) || 0) * 100));
const fmt = (v?: bigint) => (v === undefined ? "—" : (Number(v) / 100).toFixed(2));

// Bridge IN: lock USDC on the source escrow → a relayer privateMints the
// confidential xUSD equivalent to `fujiRecipient` on the eERC (run the relayer
// script). This tab performs the on-chain lock; balances update after the
// relayer mints.
export function BridgeLockForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const amount = toUnits(amt);
  const recipient = (to || address || "") as `0x${string}`;

  const usdcBal = useReadContract({
    address: DEFI.usdc, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 5000 },
  });
  const locked = useReadContract({
    address: DEFI.bridge, abi: BRIDGE_ABI, functionName: "totalLocked",
    query: { refetchInterval: 8000 },
  });

  async function faucet() {
    if (!address) return;
    setBusy(true);
    try {
      const h = await writeContractAsync({ address: DEFI.usdc, abi: ERC20_ABI, functionName: "mint", args: [address, 100000n] });
      await publicClient!.waitForTransactionReceipt({ hash: h });
      toast.success("Minted 1000 USDC"); usdcBal.refetch();
    } catch (e) { toast.error((e as Error).message.slice(0, 120)); }
    finally { setBusy(false); }
  }

  async function lock() {
    if (!address) return;
    if (amount <= 0n) return toast.error("Enter an amount");
    if (!isAddress(recipient)) return toast.error("Invalid recipient");
    if (usdcBal.data !== undefined && amount > (usdcBal.data as bigint)) return toast.error("Insufficient USDC");
    setBusy(true);
    try {
      const allowance = (await publicClient!.readContract({
        address: DEFI.usdc, abi: ERC20_ABI, functionName: "allowance", args: [address, DEFI.bridge],
      })) as bigint;
      if (allowance < amount) {
        const ah = await writeContractAsync({ address: DEFI.usdc, abi: ERC20_ABI, functionName: "approve", args: [DEFI.bridge, amount] });
        await publicClient!.waitForTransactionReceipt({ hash: ah });
      }
      const lh = await writeContractAsync({ address: DEFI.bridge, abi: BRIDGE_ABI, functionName: "lock", args: [amount, recipient] });
      await publicClient!.waitForTransactionReceipt({ hash: lh });
      toast.success(`Locked ${amt} USDC — relayer will mint xUSD`, {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(lh), "_blank") },
      });
      setAmt(""); usdcBal.refetch(); locked.refetch();
    } catch (e) { toast.error((e as Error).message.slice(0, 140)); }
    finally { setBusy(false); }
  }

  return (
    <RegisterGate>
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>USDC balance: <b className="text-foreground">{fmt(usdcBal.data as bigint)}</b> · escrow TVL <b className="text-foreground">{fmt(locked.data as bigint)}</b></span>
            <button onClick={faucet} disabled={busy} className="text-primary hover:underline disabled:opacity-50">+ mint test USDC</button>
          </div>

          <AmountCard
            label="Lock (USDC)"
            token={<TokenChip symbol="USDC" primary />}
            value={amt}
            onChange={setAmt}
            placeholder="0.0"
            right={<button onClick={() => usdcBal.data && setAmt(String(Number(usdcBal.data) / 100))} className="text-[11px] text-primary hover:underline">Max</button>}
          />

          <div className="space-y-2">
            <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Recipient on Fuji (registered eERC address)</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={address || "0x…"} className="bg-muted/50 border-border h-11" />
          </div>

          <Button disabled={busy || amount <= 0n || !address} onClick={lock} className="w-full h-12 rounded-xl">
            {busy ? "Locking…" : "Lock & bridge to private xUSD"}
          </Button>

          <Banner tone="info">
            Locks USDC on the source escrow and emits a <code>Locked</code> event.
            The XORR relayer mints the confidential xUSD to the recipient on the
            eERC — no on-chain link between the public lock and the encrypted mint.
          </Banner>
        </div>
      </div>
    </RegisterGate>
  );
}
