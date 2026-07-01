"use client";

import { ComingSoon } from "@/components/flows/coming-soon";

export default function ClaimPage() {
  return (
    <div className="w-full max-w-xl mx-auto pt-8 pb-10">
      <ComingSoon
        title="Claim a payment"
        points={[
          "Receive confidential xUSD sent to your email or social handle, claimable from any device.",
          "Custodial-key onboarding without a seed phrase.",
        ]}
        note={
          <>
            The Stellar build used Privy + email delivery to let non-crypto users
            claim shielded funds. On Avalanche this pairs a custodial signer with
            eERC registration — on the roadmap. For now, receive directly to your
            registered address on the Pay tab.
          </>
        }
      />
    </div>
  );
}
