"use client";

import { ComingSoon } from "@/components/flows/coming-soon";

export default function OfframpPage() {
  return (
    <div className="w-full max-w-xl mx-auto pt-8 pb-10">
      <ComingSoon
        title="Private fiat off-ramp"
        points={[
          "Cash out confidential xUSD to fiat through a regulated off-ramp partner.",
          "Amounts stay private up to the ramp boundary, with an auditor trail for compliance.",
        ]}
        note={
          <>
            The Stellar build shipped a real SEP-24 anchor off-ramp. The Avalanche
            corridor pairs an eERC withdrawal with an off-ramp provider — on the
            roadmap.
          </>
        }
      />
    </div>
  );
}
