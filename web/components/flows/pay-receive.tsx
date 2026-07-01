"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/app/segmented-tabs";
import { PayForm } from "./pay-form";
import { ReceivePanel } from "./receive-panel";

type Mode = "Send" | "Receive";

/** Combined Pay + Receive tab: an inner Send/Receive toggle over the two flows. */
export function PayReceive() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "receive" ? "Receive" : "Send");

  return (
    <div className="space-y-4">
      <SegmentedControl
        tabs={["Send", "Receive"]}
        value={mode}
        onChange={(m) => setMode(m as Mode)}
        layoutId="pay-receive-pill"
      />
      {mode === "Send" ? <PayForm /> : <ReceivePanel />}
    </div>
  );
}
