"use client";

import { ComingSoon } from "@/components/flows/coming-soon";

export default function SolvencyPage() {
  return (
    <div className="w-full max-w-xl mx-auto pt-8 pb-10">
      <ComingSoon
        title="Proof of solvency"
        points={[
          "Prove your encrypted xUSD balance is ≥ a threshold without revealing the amount.",
          "A range/threshold zk-SNARK over your eERC ciphertext balance.",
        ]}
        note={
          <>
            Carried over from the XORR Stellar build&apos;s confidential
            proof-of-funds. On eERC this is a threshold proof over the encrypted
            balance — wiring in progress.
          </>
        }
      />
    </div>
  );
}
