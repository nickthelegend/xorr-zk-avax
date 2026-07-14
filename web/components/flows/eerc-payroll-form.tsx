"use client";

import { useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { Plus, Trash2, ShieldCheck, Lock, ExternalLink, ArrowRight } from "lucide-react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { RegisterGate } from "@/components/wallet/register-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/wallet/scaffold";
import { ASSET_SYMBOL, explorerTx } from "@/lib/config";
import { parseAmount, short } from "@/lib/format";
import { toast } from "sonner";

interface Row {
  address: string;
  amount: string;
}
interface Paid {
  address: string;
  amount: string;
  hash: string;
}

// eERC end-to-end ciphertext payout: the employer issues confidential xUSD to each
// recipient's registered eERC address via `privateMint`. The amount is encrypted to the
// recipient's key AND the auditor's key — it is NEVER plaintext on-chain, not even at
// "claim" time (there is no claim; the value lands directly in their encrypted balance).
// Compliance is the eERC's built-in auditor: it can decrypt every payout on the Compliance
// page, without weakening anyone else's privacy.
function Inner() {
  const { address, owner, run, refresh, privateMint, isAddressRegistered } = useWallet();
  const [rows, setRows] = useState<Row[]>([{ address: "", amount: "" }]);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid[] | null>(null);

  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const valid = rows.filter((r) => isAddress(r.address.trim()) && Number(r.amount) > 0);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function payAll() {
    if (valid.length === 0) return toast.error("Add a registered eERC address + amount");
    setBusy(true);
    setPaid(null);
    const done: Paid[] = [];
    try {
      // one confidential mint per recipient — each generates a zk proof + encrypts the
      // amount to (recipient, auditor). We verify registration first (privateMint needs
      // the recipient's on-chain BabyJubJub key).
      for (const r of valid) {
        const to = r.address.trim() as `0x${string}`;
        const { isRegistered } = await isAddressRegistered(to);
        if (!isRegistered) throw new Error(`${short(to)} is not a registered eERC user`);
        // eslint-disable-next-line no-await-in-loop
        await run(`Paying ${short(to)} confidentially`, async () => {
          const res = await privateMint(to, parseAmount(r.amount));
          if (res?.transactionHash) done.push({ address: to, amount: r.amount, hash: res.transactionHash });
        });
      }
      refresh();
      if (done.length) {
        setPaid(done);
        toast.success(`Paid ${done.length} recipient(s) in confidential ${ASSET_SYMBOL}`);
      }
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  if (paid) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 font-semibold text-foreground">
              <Lock className="h-4 w-4 text-primary" /> Confidential payroll sent
            </h3>
            <button onClick={() => { setPaid(null); setRows([{ address: "", amount: "" }]); }} className="text-xs text-primary hover:underline">
              New run
            </button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Each recipient now holds confidential {ASSET_SYMBOL} in their encrypted balance. The amount was
            <b className="text-foreground"> never plaintext on-chain</b> — only ciphertext + a zk-proof landed.
          </p>
          <ul className="space-y-2">
            {paid.map((p, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <Lock className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-foreground">{short(p.address)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    🔒 {p.amount} {ASSET_SYMBOL} · amount encrypted end-to-end
                  </div>
                </div>
                <a href={explorerTx(p.hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  {p.hash.slice(0, 8)}… <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
          <Banner tone="info">
            Compliance is built in: the designated eERC auditor can decrypt every payout —{" "}
            <Link href="/compliance" className="text-primary underline inline-flex items-center gap-0.5">
              open the Compliance page <ArrowRight className="h-3 w-3" />
            </Link>{" "}
            and choose <b>Decrypt transaction history</b>.
          </Banner>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        {!isOwner && (
          <Banner tone="warn">
            Confidential issuance (<code>privateMint</code>) is owner-gated on this standalone eERC token. Connect
            the token deployer to issue payroll, or use the <b>Confidential</b> (USDC) rail instead.
          </Banner>
        )}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={r.address}
                onChange={(e) => setRow(i, { address: e.target.value })}
                placeholder="0x… registered eERC address"
                className="bg-muted/50 border-border h-11 flex-1 font-mono text-xs"
              />
              <Input
                value={r.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                placeholder="0.00"
                className="bg-muted/50 border-border h-11 w-28 font-mono"
                inputMode="decimal"
              />
              <button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs))} className="shrink-0 rounded-lg border border-border p-2.5 text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={rows.length <= 1}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button onClick={() => setRows((rs) => [...rs, { address: "", amount: "" }])} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <Plus className="h-4 w-4" /> Add recipient
          </button>
          {address && (
            <button onClick={() => setRow(0, { address })} className="text-[11px] text-muted-foreground hover:text-primary">
              use my address
            </button>
          )}
        </div>

        <Button disabled={busy || valid.length === 0} onClick={payAll} className="w-full h-12 rounded-xl gap-1.5">
          <ShieldCheck className="h-4 w-4" />
          {busy ? "Issuing confidential payroll…" : `Pay ${valid.length || ""} confidentially in ${ASSET_SYMBOL}`}
        </Button>

        <Banner tone="info">
          Pays each recipient in confidential {ASSET_SYMBOL} via the eERC — the amount is encrypted to their key
          (and the auditor&apos;s) end-to-end and lands straight in their encrypted balance. No claim, no public
          transfer, nothing to reveal. Recipients must be registered eERC users; compliance is the built-in auditor.
        </Banner>
      </div>
    </div>
  );
}

export function EercPayrollForm() {
  return (
    <RegisterGate>
      <Inner />
    </RegisterGate>
  );
}
