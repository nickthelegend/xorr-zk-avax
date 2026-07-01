"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useWallet } from "@/components/stellar-wallet-provider";
import { WalletScaffold, Banner, ConnectNudge } from "@/components/wallet/scaffold";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSET_SYMBOL, explorerTx } from "@/lib/config";
import { short } from "@/lib/format";
import { toast } from "sonner";

const labelCls = "font-mono text-[10px] uppercase tracking-wider text-muted-foreground";
const inputCls = "bg-muted/50 border-border h-11";

// eERC compliance = the built-in auditor. Every private op encodes an auditor
// PCT under the auditor's key; the designated auditor can selectively decrypt
// the full history without weakening anyone else's privacy — and without a
// redeploy when the key rotates.
export default function CompliancePage() {
  return (
    <WalletScaffold
      eyebrow="Compliance"
      title="Auditor & selective disclosure"
      description="eERC has a built-in, rotatable auditor. The token owner designates an auditor; that wallet can decrypt transaction history for compliance — private for everyone else, auditable when it must be."
      flow
      requireConnect={false}
    >
      <div className="space-y-4">
        <StatusCard />
        <SetAuditorCard />
        <AuditorDashboard />
      </div>
    </WalletScaffold>
  );
}

function StatusCard() {
  const { isAuditorKeySet, auditorAddress, owner, address, areYouAuditor } = useWallet();
  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">Auditor status</h3>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Field k="Auditor set" v={isAuditorKeySet ? "Yes" : "Not yet"} />
        <Field k="Auditor" v={auditorAddress ? short(auditorAddress) : "—"} />
        <Field k="Token owner" v={owner ? short(owner) : "—"} />
        <Field k="You are" v={areYouAuditor ? "the auditor" : address ? "a user" : "disconnected"} />
      </div>
    </div>
  );
}

function SetAuditorCard() {
  const { address, owner, setAuditor, isAddressRegistered, pushLog } = useWallet();
  const [auditor, setAuditorAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner =
    !!address && !!owner && address.toLowerCase() === owner.toLowerCase();

  const useMe = () => address && setAuditorAddr(address);

  const submit = async () => {
    if (!isAddress(auditor.trim())) return toast.error("Enter a valid 0x auditor address");
    setBusy(true);
    try {
      const { isRegistered } = await isAddressRegistered(auditor.trim() as `0x${string}`);
      if (!isRegistered) throw new Error("Auditor must be a registered eERC user first");
      const tx = await setAuditor(auditor.trim() as `0x${string}`);
      pushLog(`Auditor set → ${short(auditor.trim())}`);
      toast.success("Auditor set", {
        action: tx
          ? { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(tx), "_blank") }
          : undefined,
      });
    } catch (e) {
      toast.error((e as Error).message);
      pushLog(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
        Designate auditor <span className="text-muted-foreground normal-case">(owner only)</span>
      </h3>
      {!address ? (
        <div className="mt-4">
          <ConnectNudge />
        </div>
      ) : !isOwner ? (
        <div className="mt-4">
          <Banner tone="warn">
            Only the token owner can set the auditor. Connected wallet is not the owner.
          </Banner>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label className={labelCls}>Auditor address (must be a registered eERC user)</Label>
            <div className="flex gap-2">
              <Input
                value={auditor}
                onChange={(e) => setAuditorAddr(e.target.value)}
                placeholder="0x…"
                className={`${inputCls} font-mono text-xs`}
              />
              <Button variant="outline" onClick={useMe} className="h-11 text-xs shrink-0">
                Use me
              </Button>
            </div>
          </div>
          <Button disabled={busy || !auditor} onClick={submit} className="w-full h-12 rounded-xl text-sm font-medium">
            {busy ? "Setting…" : "Set auditor public key"}
          </Button>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Rotation is forward-looking: setting a new auditor changes who future
            operations encode PCTs for; it doesn&apos;t retroactively grant access
            to history encoded for a previous auditor.
          </p>
        </div>
      )}
    </div>
  );
}

type AuditTx = {
  type: string;
  amount: string;
  sender: string;
  receiver: string | null;
  transactionHash: string;
};

function AuditorDashboard() {
  const { areYouAuditor, auditorDecrypt } = useWallet();
  const [txs, setTxs] = useState<AuditTx[] | null>(null);
  const [busy, setBusy] = useState(false);

  const decrypt = async () => {
    setBusy(true);
    try {
      const res = (await auditorDecrypt()) as AuditTx[];
      setTxs(res);
      toast.success(`Decrypted ${res.length} transaction(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">Auditor dashboard</h3>
      <p className="text-xs text-muted-foreground mt-1">
        If your wallet holds the auditor key, decrypt the full transaction
        history — type, amount, sender and receiver — for compliance.
      </p>

      {!areYouAuditor ? (
        <div className="mt-4">
          <Banner tone="info">
            Connected wallet is not the current auditor. Only the auditor can decrypt history.
          </Banner>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Button onClick={decrypt} disabled={busy} className="h-11 rounded-xl text-xs">
            {busy ? "Decrypting…" : "Decrypt transaction history"}
          </Button>

          {txs && txs.length === 0 && (
            <Banner tone="info">No transactions to disclose yet.</Banner>
          )}

          {txs && txs.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Type</th>
                    <th className="text-right font-medium px-3 py-2">Amount</th>
                    <th className="text-left font-medium px-3 py-2">From</th>
                    <th className="text-left font-medium px-3 py-2">To</th>
                    <th className="text-right font-medium px-3 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{t.type}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {t.amount} {ASSET_SYMBOL}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{short(t.sender)}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {t.receiver ? short(t.receiver) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a
                          className="text-primary underline"
                          href={explorerTx(t.transactionHash)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.transactionHash.slice(0, 8)}…
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-xs text-foreground font-medium truncate">{v}</div>
    </div>
  );
}
