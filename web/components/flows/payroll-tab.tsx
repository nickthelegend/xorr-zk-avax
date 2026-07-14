"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/app/segmented-tabs";
import { PayrollForm } from "@/components/flows/payroll-form";
import { ConfidentialPayrollForm } from "@/components/flows/confidential-payroll-form";
import { ComplianceVerify } from "@/components/flows/compliance-verify";

const MODES = ["Standard", "Confidential", "Verify"] as const;
type Mode = (typeof MODES)[number];

// Payroll tab: Standard (v1, public amounts), Confidential (v2, hidden amounts +
// compliance ciphers + on-chain attestation), and Verify (anyone re-checks a report).
export function PayrollTab() {
  const [mode, setMode] = useState<Mode>("Confidential");
  return (
    <div className="space-y-4">
      <SegmentedControl tabs={[...MODES]} value={mode} onChange={(m) => setMode(m as Mode)} />
      {mode === "Standard" ? <PayrollForm /> : mode === "Confidential" ? <ConfidentialPayrollForm /> : <ComplianceVerify />}
    </div>
  );
}
