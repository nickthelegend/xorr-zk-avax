"use client";

import { useState } from "react";
import { usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { BadgeCheck, X, ShieldCheck, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/wallet/scaffold";
import { CONF_PAYROLL_ABI, amountCommit, fromUsdc } from "@/lib/payroll";
import {
  COMPLIANCE_REGISTRY,
  COMPLIANCE_REGISTRY_ABI,
  reportFromJSON,
  verifyReport,
  type VerifyResult,
} from "@/lib/compliance";
import { explorerAddress } from "@/lib/config";
import { toast } from "sonner";

// Independent verification of a published compliance report — anyone, no keys.
// Re-derives every commitment from the report, re-reads the chain, and confirms the
// on-chain attestation was signed by the run's designated auditor.
export function ComplianceVerify() {
  const publicClient = usePublicClient();
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ v: VerifyResult; auditor: string; timestamp: number; runId: number } | null>(null);

  async function verify() {
    setBusy(true);
    setRes(null);
    try {
      const report = reportFromJSON(json.trim());
      // read the run's designated auditor + each slot's on-chain commitment
      const run = (await publicClient!.readContract({
        address: report.payroll, abi: CONF_PAYROLL_ABI, functionName: "getRun", args: [BigInt(report.runId)],
      })) as { auditor: `0x${string}` };
      const onchainCommits: Hex[] = [];
      for (const s of report.slots) {
        const slot = (await publicClient!.readContract({
          address: report.payroll, abi: CONF_PAYROLL_ABI, functionName: "getSlot", args: [BigInt(report.runId), BigInt(s.slot)],
        })) as { amountCommit: Hex };
        onchainCommits[s.slot] = slot.amountCommit;
      }
      // read the on-chain attestation
      const att = (await publicClient!.readContract({
        address: COMPLIANCE_REGISTRY, abi: COMPLIANCE_REGISTRY_ABI, functionName: "getAttestation", args: [report.payroll, BigInt(report.runId)],
      })) as { auditor: `0x${string}`; reportHash: Hex; verifiedTotal: bigint; timestamp: bigint };

      const v = verifyReport({
        report,
        amountCommit,
        onchainCommits,
        runAuditor: run.auditor,
        attestation: att,
      });
      setRes({ v, auditor: att.auditor, timestamp: Number(att.timestamp), runId: report.runId });
      toast[v.ok ? "success" : "error"](v.ok ? "Report VERIFIED against the chain ✓" : "Verification FAILED");
    } catch (e) {
      toast.error("Couldn’t parse / verify: " + (e as Error).message.slice(0, 100));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h3 className="flex items-center gap-1.5 font-semibold text-foreground">
          <FileSearch className="h-4 w-4 text-primary" /> Verify a compliance report
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Paste a published report. This checks — using only public data — that every amount opens its
          on-chain commitment, the report hash + total match what was anchored, and the attestation was
          signed by the run’s designated auditor. No keys required.
        </p>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='{ "payroll": "0x…", "runId": 0, "slots": [...], "auditor": "0x…", "total": "…" }'
          className="h-40 w-full resize-y rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs text-foreground"
        />
        <Button onClick={verify} disabled={busy || !json.trim()} className="w-full h-11 gap-1.5">
          <ShieldCheck className="h-4 w-4" /> {busy ? "Verifying…" : "Verify report"}
        </Button>

        {res && (
          <div className="space-y-3">
            <div
              className={
                "flex items-center gap-2 rounded-xl border p-3 " +
                (res.v.ok ? "border-primary/40 bg-primary/5 text-primary" : "border-destructive/40 bg-destructive/5 text-destructive")
              }
            >
              {res.v.ok ? <BadgeCheck className="h-5 w-5" /> : <X className="h-5 w-5" />}
              <div className="text-sm font-semibold">
                {res.v.ok ? "VERIFIED" : "VERIFICATION FAILED"}
                {res.timestamp > 0 && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    · attested {new Date(res.timestamp * 1000).toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <ul className="space-y-1.5">
              {res.v.checks.map((c) => (
                <li key={c.name} className="flex items-center gap-2 text-sm">
                  {c.ok ? (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className={c.ok ? "text-foreground" : "text-destructive"}>{c.name}</span>
                </li>
              ))}
            </ul>

            <div className="text-xs text-muted-foreground">
              Designated auditor:{" "}
              <a href={explorerAddress(res.auditor)} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
                {res.auditor.slice(0, 10)}…{res.auditor.slice(-6)}
              </a>
            </div>
          </div>
        )}

        <Banner tone="info">
          Verification uses commitments, the report hash, and the auditor’s on-chain attestation — all public.
          A forged report (any altered amount) fails the commitment check, so the audit can’t be faked.
        </Banner>
      </div>
    </div>
  );
}
