"use client";

import { ComingSoon } from "@/components/flows/coming-soon";

export default function ExplorePage() {
  return (
    <div className="w-full max-w-xl mx-auto pt-8 pb-10">
      <ComingSoon
        title="Confidential money markets"
        points={[
          "Supply and borrow against your encrypted xUSD balance.",
          "Compound-style pools with confidential positions on Avalanche.",
        ]}
        note={
          <>
            Ported from the XORR Stellar money market. On Avalanche this builds on
            eERC confidential balances — wiring in progress.
          </>
        }
      />
    </div>
  );
}
