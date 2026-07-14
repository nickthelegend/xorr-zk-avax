"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/app/segmented-tabs";
import { PayrollForm } from "@/components/flows/payroll-form";
import { ConfidentialPayrollForm } from "@/components/flows/confidential-payroll-form";

const MODES = ["Standard", "Confidential"] as const;
type Mode = (typeof MODES)[number];

// Payroll tab: Standard (v1, public amounts) vs Confidential (v2, amounts hidden
// behind commitments + compliance ciphers).
export function PayrollTab() {
  const [mode, setMode] = useState<Mode>("Confidential");
  return (
    <div className="space-y-4">
      <SegmentedControl tabs={[...MODES]} value={mode} onChange={(m) => setMode(m as Mode)} />
      {mode === "Standard" ? <PayrollForm /> : <ConfidentialPayrollForm />}
    </div>
  );
}
