"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { Plus, Trash2, Copy, Mail, Check, ShieldCheck, KeyRound, Eye, Stamp, BadgeCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/wallet/scaffold";
import { DEFI, ERC20_ABI } from "@/lib/defi";
import { explorerTx } from "@/lib/config";
import {
  CONF_PAYROLL,
  CONF_PAYROLL_ABI,
  newClaimKey,
  newSalt,
  amountCommit,
  confClaimUrl,
  claimMailto,
  toUsdc,
  fromUsdc,
} from "@/lib/payroll";
import {
  newAuditorKey,
  auditorAddress,
  encryptToAuditor,
  decryptAsAuditor,
  computeReportHash,
  signAttestation,
  COMPLIANCE_REGISTRY,
  COMPLIANCE_REGISTRY_ABI,
  type AuditorKey,
  type ComplianceReport,
  type ReportSlot,
} from "@/lib/compliance";
import type { Hex } from "viem";
import { toast } from "sonner";

interface Row {
  email: string;
  amount: string;
}
interface ConfLink {
  email: string;
  amount: string;
  slot: number;
  claimKey: Hex;
  claimAddr: `0x${string}`;
  salt: Hex;
}

const RECLAIM_AFTER_DAYS = 30;

export function ConfidentialPayrollForm() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [rows, setRows] = useState<Row[]>([
    { email: "", amount: "" },
    { email: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: number; links: ConfLink[]; auditor: AuditorKey } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  // compliance panel
  const [auditKey, setAuditKey] = useState("");
  const [report, setReport] = useState<{ built: ComplianceReport; rows: { slot: number; email: string; amount: string; verified: boolean }[] } | null>(null);
  const [attested, setAttested] = useState<{ hash: string; json: string } | null>(null);

  const usdcBal = useReadContract({
    address: DEFI.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const funded = rows.filter((r) => r.email.trim() && Number(r.amount) > 0);
  const total = funded.reduce((a, r) => a + toUsdc(r.amount), 0n);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function faucet() {
    if (!address) return;
    setBusy(true);
    try {
      const h = await writeContractAsync({ address: DEFI.usdc, abi: ERC20_ABI, functionName: "mint", args: [address, 100000n] });
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
    if (funded.length === 0) return toast.error("Add at least one recipient");
    if (usdcBal.data !== undefined && total > (usdcBal.data as bigint)) return toast.error("Insufficient USDC — use the faucet");

    setBusy(true);
    try {
      // fresh compliance key for this run — the private key goes to the auditor only
      const auditor = newAuditorKey();

      const links: ConfLink[] = funded.map((r, slot) => {
        const { key, addr } = newClaimKey();
        return { email: r.email.trim(), amount: r.amount, slot, claimKey: key, claimAddr: addr, salt: newSalt() };
      });
      // per slot: commitment hides the amount; compliance cipher lets the auditor recover it
      const commits = links.map((l) => amountCommit(toUsdc(l.amount), l.salt));
      const ciphers = links.map((l) =>
        encryptToAuditor(auditor.pub, { email: l.email, amount: l.amount, salt: l.salt }),
      );

      const id = Number(
        (await publicClient!.readContract({ address: CONF_PAYROLL, abi: CONF_PAYROLL_ABI, functionName: "runCount" })) as bigint,
      );

      const allowance = (await publicClient!.readContract({
        address: DEFI.usdc, abi: ERC20_ABI, functionName: "allowance", args: [address, CONF_PAYROLL],
      })) as bigint;
      if (allowance < total) {
        const ah = await writeContractAsync({ address: DEFI.usdc, abi: ERC20_ABI, functionName: "approve", args: [CONF_PAYROLL, total] });
        await publicClient!.waitForTransactionReceipt({ hash: ah });
      }

      const expiry = BigInt(Math.floor(Date.now() / 1000) + RECLAIM_AFTER_DAYS * 86400);
      const h = await writeContractAsync({
        address: CONF_PAYROLL,
        abi: CONF_PAYROLL_ABI,
        functionName: "createRun",
        // the run's on-chain auditor = the EVM identity of the compliance key,
        // so only that key can later sign a valid attestation
        args: [DEFI.usdc, links.map((l) => l.claimAddr), commits, ciphers, total, auditorAddress(auditor.priv), expiry],
      });
      await publicClient!.waitForTransactionReceipt({ hash: h });

      setResult({ id, links, auditor });
      setAuditKey(auditor.priv); // prefill the compliance demo
      toast.success(`Funded confidential run #${id} · amounts hidden on-chain`, {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(h), "_blank") },
      });
      usdcBal.refetch();
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  function linkFor(l: ConfLink): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return confClaimUrl(origin, result!.id, l.slot, l.claimKey, toUsdc(l.amount), l.salt);
  }
  async function copyLink(l: ConfLink) {
    await navigator.clipboard.writeText(linkFor(l));
    setCopied(l.slot);
    setTimeout(() => setCopied(null), 1500);
  }

  // ── Compliance: auditor decrypts each slot AND verifies it against the
  //    on-chain commitment (a lying employer is caught here) → a report. ───────
  async function runCompliance() {
    if (!result) return;
    const priv = auditKey.trim() as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(priv)) return toast.error("Paste a 32-byte auditor private key");
    setBusy(true);
    setAttested(null);
    try {
      const n = Number(
        (await publicClient!.readContract({ address: CONF_PAYROLL, abi: CONF_PAYROLL_ABI, functionName: "slotCount", args: [BigInt(result.id)] })) as bigint,
      );
      const chainId = await publicClient!.getChainId();
      const slots: ReportSlot[] = [];
      const rows: { slot: number; email: string; amount: string; verified: boolean }[] = [];
      for (let s = 0; s < n; s++) {
        const blob = (await publicClient!.readContract({
          address: CONF_PAYROLL, abi: CONF_PAYROLL_ABI, functionName: "auditorCipher", args: [BigInt(result.id), BigInt(s)],
        })) as Hex;
        const onchain = (await publicClient!.readContract({
          address: CONF_PAYROLL, abi: CONF_PAYROLL_ABI, functionName: "getSlot", args: [BigInt(result.id), BigInt(s)],
        })) as { amountCommit: Hex };
        const rec = decryptAsAuditor(priv, blob);
        if (!rec) {
          rows.push({ slot: s, email: "—", amount: "decrypt failed", verified: false });
          continue;
        }
        const units = toUsdc(rec.amount);
        const verified = amountCommit(units, rec.salt) === onchain.amountCommit;
        slots.push({ slot: s, email: rec.email, amount: units, salt: rec.salt, commit: onchain.amountCommit });
        rows.push({ slot: s, email: rec.email, amount: Number(rec.amount).toFixed(2), verified });
      }
      const total = slots.reduce((a, s) => a + s.amount, 0n);
      const built: ComplianceReport = {
        payroll: CONF_PAYROLL,
        runId: result.id,
        chainId,
        auditor: auditorAddress(priv),
        total,
        slots,
      };
      setReport({ built, rows });
      toast.success(`Verified ${rows.filter((r) => r.verified).length}/${n} slots · total ${fromUsdc(total)} USDC`);
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  // ── Attestation: sign the verified report with the auditor key + anchor it. ──
  async function attest() {
    if (!report || !address) return;
    const priv = auditKey.trim() as Hex;
    setBusy(true);
    try {
      const r = report.built;
      const reportHash = computeReportHash(r);
      const digest = (await publicClient!.readContract({
        address: COMPLIANCE_REGISTRY, abi: COMPLIANCE_REGISTRY_ABI, functionName: "attestationDigest",
        args: [r.payroll, BigInt(r.runId), reportHash, r.total, r.auditor],
      })) as Hex;
      const sig = await signAttestation(priv, digest); // auditor signs off-chain (no gas)
      const h = await writeContractAsync({
        address: COMPLIANCE_REGISTRY, abi: COMPLIANCE_REGISTRY_ABI, functionName: "attest",
        args: [r.payroll, BigInt(r.runId), reportHash, r.total, r.auditor, sig],
      });
      await publicClient!.waitForTransactionReceipt({ hash: h });
      const { reportToJSON } = await import("@/lib/compliance");
      setAttested({ hash: h, json: reportToJSON(r) });
      toast.success("Compliance report attested on-chain ✓", {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(h), "_blank") },
      });
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  async function copyReport() {
    if (attested) await navigator.clipboard.writeText(attested.json);
    toast.success("Report JSON copied — anyone can verify it in the Verify tab");
  }

  // ── Post-fund view: claim links + compliance ───────────────────────────────
  if (result) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> Confidential run #{result.id}
            </h3>
            <button
              onClick={() => { setResult(null); setReport(null); setRows([{ email: "", amount: "" }, { email: "", amount: "" }]); }}
              className="text-xs text-primary hover:underline"
            >
              New run
            </button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Amounts are <b className="text-foreground">hidden on-chain</b> — only keccak commitments were
            published, never the salary list. Each person’s link privately carries their amount.
          </p>

          <ul className="space-y-2">
            {result.links.map((l) => (
              <li key={l.slot} className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{l.email}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    🔒 hidden on-chain · claim {l.claimAddr.slice(0, 8)}…
                  </div>
                </div>
                <button onClick={() => copyLink(l)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                  {copied === l.slot ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === l.slot ? "Copied" : "Copy"}
                </button>
                <a href={claimMailto(l.email, l.amount, linkFor(l))} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Compliance / auditor */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
          <h3 className="flex items-center gap-1.5 font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-primary" /> Compliance
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Each slot stores the amount encrypted to a compliance key. Hand the private key below to your
            auditor — they (and only they) can reconstruct the full run for reporting.
          </p>
          <div className="flex items-center gap-2">
            <Input value={auditKey} onChange={(e) => setAuditKey(e.target.value)} placeholder="0x… auditor private key" className="bg-muted/50 border-border h-11 font-mono text-xs" />
            <Button onClick={runCompliance} disabled={busy} className="h-11 shrink-0 gap-1.5">
              <Eye className="h-4 w-4" /> Verify run
            </Button>
          </div>
          {report && (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Slot</th>
                    <th className="px-3 py-2 text-left font-medium">Recipient</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-center font-medium">Commitment</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.slot} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-muted-foreground">{r.slot}</td>
                      <td className="px-3 py-2 text-foreground">{r.email}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{r.amount} USDC</td>
                      <td className="px-3 py-2 text-center">
                        {r.verified ? (
                          <span className="inline-flex items-center gap-1 text-[var(--long-text,#22c55e)]"><BadgeCheck className="h-4 w-4" /> matches</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive"><X className="h-4 w-4" /> mismatch</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report && !attested && (
            <Button onClick={attest} disabled={busy || !report.rows.every((r) => r.verified)} className="w-full h-11 gap-1.5">
              <Stamp className="h-4 w-4" /> Sign &amp; attest report on-chain
            </Button>
          )}

          {attested && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <BadgeCheck className="h-4 w-4" /> Attested on-chain
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                A signed report hash is now anchored on-chain. Share the report JSON — anyone can verify it
                against the commitments in the <b>Verify</b> tab, no keys needed.
              </p>
              <div className="flex gap-2">
                <button onClick={copyReport} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                  <Copy className="h-3.5 w-3.5" /> Copy report JSON
                </button>
                <a href={explorerTx(attested.hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                  Snowtrace ↗
                </a>
              </div>
            </div>
          )}

          <Banner tone="info">
            Every amount is checked against its on-chain <code>keccak</code> commitment, so the employer can’t
            feed a false report. The verified report is signed by the auditor key and anchored on-chain — then
            anyone can re-verify it with public data alone.
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
          <span>USDC balance: <b className="text-foreground">{usdcBal.data !== undefined ? fromUsdc(usdcBal.data as bigint) : "—"}</b></span>
          <button onClick={faucet} disabled={busy || !address} className="text-primary hover:underline disabled:opacity-50">+ mint test USDC</button>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={r.email} onChange={(e) => setRow(i, { email: e.target.value })} placeholder="name@company.com" className="bg-muted/50 border-border h-11 flex-1" type="email" />
              <Input value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="0.00" className="bg-muted/50 border-border h-11 w-28 font-mono" inputMode="decimal" />
              <button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs))} className="shrink-0 rounded-lg border border-border p-2.5 text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={rows.length <= 1}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button onClick={() => setRows((rs) => [...rs, { email: "", amount: "" }])} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <Plus className="h-4 w-4" /> Add recipient
        </button>

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">{funded.length} recipient{funded.length === 1 ? "" : "s"} · amounts hidden on-chain</span>
          <span className="font-mono text-foreground">Pool: {fromUsdc(total)} USDC</span>
        </div>

        <Button disabled={busy || funded.length === 0 || !address} onClick={fund} className="w-full h-12 rounded-xl gap-1.5">
          <ShieldCheck className="h-4 w-4" />
          {busy ? "Funding…" : `Fund confidential payroll · ${fromUsdc(total)} USDC`}
        </Button>

        <Banner tone="info">
          Only per-recipient <b>commitments</b> land on-chain — the salary split is never published. Each
          amount is also sealed to a compliance key so an auditor can reconstruct the run. (The funded pool
          total is public; individual amounts appear only when each person claims their own slot.)
        </Banner>
      </div>
    </div>
  );
}
