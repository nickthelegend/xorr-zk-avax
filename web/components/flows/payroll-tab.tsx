"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/app/segmented-tabs";
import { PayrollForm } from "@/components/flows/payroll-form";
import { ConfidentialPayrollForm } from "@/components/flows/confidential-payroll-form";
import { EercPayrollForm } from "@/components/flows/eerc-payroll-form";
import { ComplianceVerify } from "@/components/flows/compliance-verify";

const MODES = ["Standard", "Confidential", "eERC", "Verify"] as const;
type Mode = (typeof MODES)[number];

// Payroll rails:
//   Standard    — v1 claim-link, public USDC amounts.
//   Confidential— v2 claim-link, amounts hidden by commitments + attested compliance (USDC).
//   eERC        — end-to-end ciphertext: pay confidential xUSD straight into encrypted
//                 balances; amount never plaintext; native eERC auditor compliance.
//   Verify      — anyone re-checks a published confidential-run compliance report.
export function PayrollTab() {
  const [mode, setMode] = useState<Mode>("eERC");
  return (
    <div className="space-y-4">
      <SegmentedControl tabs={[...MODES]} value={mode} onChange={(m) => setMode(m as Mode)} />
      {mode === "Standard" ? (
        <PayrollForm />
      ) : mode === "Confidential" ? (
        <ConfidentialPayrollForm />
      ) : mode === "eERC" ? (
        <EercPayrollForm />
      ) : (
        <ComplianceVerify />
      )}
    </div>
  );
}
