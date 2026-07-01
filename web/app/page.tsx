"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useWallet } from "@/components/stellar-wallet-provider";
import { SegmentedControl } from "@/components/app/segmented-tabs";
import { PayReceive } from "@/components/flows/pay-receive";
import { DepositForm } from "@/components/flows/deposit-form";
import { ComingSoon } from "@/components/flows/coming-soon";
import { ASSET_SYMBOL } from "@/lib/config";

const TABS = ["Deposit", "Pay", "Swap", "Bridge"] as const;
type Tab = (typeof TABS)[number];

function SwapSoon() {
  return (
    <ComingSoon
      title="Confidential swaps"
      points={[
        "Spend from your encrypted xUSD balance into an AMM with no on-chain link to your trade.",
        "Routes a private eERC transfer through a constant-product pool.",
      ]}
      note={
        <>
          Ported from the XORR Stellar build&apos;s <code>private_swap</code>. On
          Avalanche this composes an eERC confidential transfer with a DEX venue —
          wiring in progress.
        </>
      }
    />
  );
}

function BridgeSoon() {
  return (
    <ComingSoon
      title="Bridge into private xUSD"
      points={[
        "Lock USDC on another chain, mint confidential xUSD on Fuji with a zk proof.",
        "No on-chain link between the deposit and the encrypted claim.",
      ]}
      note={
        <>
          The Stellar build bridged ETH→Stellar into shielded notes; the Avalanche
          port maps this onto eERC converter-mode deposits.
        </>
      }
    />
  );
}

const FORMS: Record<Tab, React.ComponentType> = {
  Deposit: DepositForm,
  Pay: PayReceive,
  Swap: SwapSoon,
  Bridge: BridgeSoon,
};

const META: Record<Tab, { title: string; desc: string }> = {
  Deposit: {
    title: "Mint",
    desc: `Mint confidential ${ASSET_SYMBOL} into your encrypted balance. The amount is encrypted with your key and only ciphertext + a zk-SNARK land on-chain — the value itself never appears.`,
  },
  Pay: {
    title: "Pay & Receive",
    desc: "Send a confidential payment, or share your address to get paid. Amounts and the sender↔receiver link stay hidden on-chain, verified by a Groth16 proof.",
  },
  Swap: {
    title: "Swap",
    desc: "Swap from your encrypted balance with no on-chain link to your trade.",
  },
  Bridge: {
    title: "Bridge",
    desc: "Bridge external USDC into private xUSD on Avalanche Fuji.",
  },
};

const QUERY_TO_TAB: Record<string, Tab> = {
  pay: "Pay",
  receive: "Pay",
  swap: "Swap",
  bridge: "Bridge",
  deposit: "Deposit",
  mint: "Deposit",
};

export default function HomePage() {
  const { ready } = useWallet();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(QUERY_TO_TAB[params.get("tab") ?? ""] ?? "Deposit");

  const onChange = (t: string) => {
    const next = t as Tab;
    setTab(next);
    router.replace(`/?tab=${next.toLowerCase()}`, { scroll: false });
  };

  if (!ready) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-10">
            <span className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
          </div>
          <span className="text-muted-foreground font-mono text-xs tracking-wide">
            initializing confidential wallet…
          </span>
        </div>
      </div>
    );
  }

  const safeTab: Tab = TABS.includes(tab) ? tab : "Deposit";
  const m = META[safeTab];
  const ActiveForm = FORMS[safeTab];

  return (
    <div className="w-full max-w-xl mx-auto pt-4 pb-10 space-y-6">
      <SegmentedControl tabs={[...TABS]} value={tab} onChange={onChange} />

      <motion.div
        key={tab}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-medium text-foreground">{m.title}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{m.desc}</p>
        </div>
        <ActiveForm />
      </motion.div>
    </div>
  );
}
