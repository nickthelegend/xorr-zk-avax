"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { Plus, Trash2, Copy, Mail, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/wallet/scaffold";
import { DEFI, ERC20_ABI } from "@/lib/defi";
import { explorerTx } from "@/lib/config";
import {
  PAYROLL,
  PAYROLL_ABI,
  newClaimKey,
  claimUrl,
  claimMailto,
  toUsdc,
  fromUsdc,
  type ClaimLink,
} from "@/lib/payroll";
import { toast } from "sonner";

interface Row {
  email: string;
  amount: string;
}

const RECLAIM_AFTER_DAYS = 30;

export function PayrollForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [rows, setRows] = useState<Row[]>([
    { email: "", amount: "" },
    { email: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: number; links: ClaimLink[] } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const usdcBal = useReadContract({
    address: DEFI.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const funded = rows.filter((r) => r.email.trim() && Number(r.amount) > 0);
  const total = funded.reduce((a, r) => a + toUsdc(r.amount), 0n);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { email: "", amount: "" }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs));

  async function faucet() {
    if (!address) return;
    setBusy(true);
    try {
      const h = await writeContractAsync({
        address: DEFI.usdc,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [address, 100000n],
      });
      await publicClient!.waitForTransactionReceipt({ hash: h });
      toast.success("Minted 1000 USDC");
      usdcBal.refetch();
    } catch (e) {
      toast.error((e as Error).message.slice(0, 120));
    } finally {
      setBusy(false);
    }
  }

  async function fund() {
    if (!address) return toast.error("Connect a wallet");
    if (funded.length === 0) return toast.error("Add at least one recipient with an amount");
    if (usdcBal.data !== undefined && total > (usdcBal.data as bigint))
      return toast.error("Insufficient USDC — use the faucet");

    setBusy(true);
    try {
      // one throwaway claim key per recipient (secret → emailed link; address → chain)
      const links: ClaimLink[] = funded.map((r, slot) => {
        const { key, addr } = newClaimKey();
        return { email: r.email.trim(), amount: r.amount, claimKey: key, claimAddr: addr, slot };
      });

      // the next payroll id is the current count
      const id = Number(
        (await publicClient!.readContract({
          address: PAYROLL,
          abi: PAYROLL_ABI,
          functionName: "payrollCount",
        })) as bigint,
      );

      // approve the escrow for the batch total, then fund in one call
      const allowance = (await publicClient!.readContract({
        address: DEFI.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, PAYROLL],
      })) as bigint;
      if (allowance < total) {
        const ah = await writeContractAsync({
          address: DEFI.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [PAYROLL, total],
        });
        await publicClient!.waitForTransactionReceipt({ hash: ah });
      }

      const expiry = BigInt(Math.floor(Date.now() / 1000) + RECLAIM_AFTER_DAYS * 86400);
      const h = await writeContractAsync({
        address: PAYROLL,
        abi: PAYROLL_ABI,
        functionName: "createPayroll",
        args: [
          DEFI.usdc,
          links.map((l) => l.claimAddr),
          links.map((l) => toUsdc(l.amount)),
          expiry,
        ],
      });
      await publicClient!.waitForTransactionReceipt({ hash: h });

      setResult({ id, links });
      toast.success(`Funded payroll #${id} · ${fromUsdc(total)} USDC → ${links.length} people`, {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(h), "_blank") },
      });
      usdcBal.refetch();
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  function linkFor(l: ClaimLink): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return claimUrl(origin, result!.id, l.slot, l.claimKey);
  }

  async function copyLink(l: ClaimLink) {
    await navigator.clipboard.writeText(linkFor(l));
    setCopied(l.slot);
    setTimeout(() => setCopied(null), 1500);
  }

  // ── Post-fund: show the private claim links ────────────────────────────────
  if (result) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Payroll #{result.id} funded 🔒</h3>
            <button
              onClick={() => {
                setResult(null);
                setRows([{ email: "", amount: "" }, { email: "", amount: "" }]);
              }}
              className="text-xs text-primary hover:underline"
            >
              New run
            </button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Send each person their private claim link. The secret lives in the link (not
            on-chain) — they connect any wallet and collect. Unclaimed pay is reclaimable
            after {RECLAIM_AFTER_DAYS} days.
          </p>

          <ul className="space-y-2">
            {result.links.map((l) => (
              <li
                key={l.slot}
                className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{l.email}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {l.amount} USDC · claim {l.claimAddr.slice(0, 8)}…
                  </div>
                </div>
                <button
                  onClick={() => copyLink(l)}
                  title="Copy claim link"
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted"
                >
                  {copied === l.slot ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === l.slot ? "Copied" : "Copy"}
                </button>
                <a
                  href={claimMailto(l.email, l.amount, linkFor(l))}
                  title="Email this claim link"
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              </li>
            ))}
          </ul>

          <Banner tone="warn">
            These links are secrets — anyone who opens one can direct that payment. Deliver
            them privately. (Delivery is via your own mail client; XORR never sees the link.)
          </Banner>
        </div>
      </div>
    );
  }

  // ── Batch builder ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            USDC balance:{" "}
            <b className="text-foreground">
              {usdcBal.data !== undefined ? fromUsdc(usdcBal.data as bigint) : "—"}
            </b>
          </span>
          <button onClick={faucet} disabled={busy || !address} className="text-primary hover:underline disabled:opacity-50">
            + mint test USDC
          </button>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={r.email}
                onChange={(e) => setRow(i, { email: e.target.value })}
                placeholder="name@company.com"
                className="bg-muted/50 border-border h-11 flex-1"
                type="email"
              />
              <Input
                value={r.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                placeholder="0.00"
                className="bg-muted/50 border-border h-11 w-28 font-mono"
                inputMode="decimal"
              />
              <button
                onClick={() => removeRow(i)}
                className="shrink-0 rounded-lg border border-border p-2.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
                disabled={rows.length <= 1}
                title="Remove row"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addRow}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Plus className="h-4 w-4" /> Add recipient
        </button>

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">
            {funded.length} recipient{funded.length === 1 ? "" : "s"}
          </span>
          <span className="font-mono text-foreground">Total: {fromUsdc(total)} USDC</span>
        </div>

        <Button
          disabled={busy || funded.length === 0 || !address}
          onClick={fund}
          className="w-full h-12 rounded-xl"
        >
          {busy ? "Funding payroll…" : `Fund payroll · ${fromUsdc(total)} USDC`}
        </Button>

        <Banner tone="info">
          One approval + one transaction escrows the whole batch. Each recipient gets a
          private, email-delivered claim link — no wallet needed up front, and the
          employee↔amount mapping never touches the chain.
        </Banner>
      </div>
    </div>
  );
}
