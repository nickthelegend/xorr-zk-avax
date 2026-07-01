"use client";

import { useState } from "react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { WalletScaffold } from "@/components/wallet/scaffold";
import { RegisterGate } from "@/components/wallet/register-gate";
import { Button } from "@/components/ui/button";
import { AmountCard, TokenChip } from "@/components/wallet/fields";
import { ASSET_SYMBOL } from "@/lib/config";
import { parseAmount } from "@/lib/format";

// Standalone eERC: "Withdraw" burns confidential xUSD from your encrypted
// balance (privateBurn) — reducing the (hidden) supply. A zk-SNARK proves the
// burn is valid without revealing the amount.
export default function WithdrawPage() {
  const { busy, run, refresh, privateBurn, parsedBalance, balance } = useWallet();
  const [amt, setAmt] = useState("");

  const submit = () =>
    run("Generating burn proof", async () => {
      const value = parseAmount(amt);
      if (value <= 0n) throw new Error("Enter an amount greater than zero");
      if (value > balance) throw new Error("Insufficient encrypted balance");
      await privateBurn(value);
      setAmt("");
      refresh();
    });

  return (
    <WalletScaffold
      eyebrow="Unshield"
      title="Withdraw"
      description="Burn confidential xUSD from your encrypted balance. The amount stays hidden — only a zk proof of a valid burn is posted."
      flow
    >
      <RegisterGate>
        <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Spendable balance:{" "}
            <b className="text-foreground">{parsedBalance} {ASSET_SYMBOL}</b>. Your
            wallet generates the proof client-side; the contract verifies it and
            updates only the ciphertext.
          </p>

          <AmountCard
            label={`Amount to burn (${ASSET_SYMBOL})`}
            token={<TokenChip symbol={ASSET_SYMBOL} primary />}
            value={amt}
            onChange={setAmt}
            placeholder="0.0"
            right={
              <button
                type="button"
                onClick={() => setAmt(parsedBalance)}
                className="text-[11px] text-primary hover:underline"
              >
                Max · {parsedBalance} {ASSET_SYMBOL}
              </button>
            }
          />

          <Button
            disabled={busy || !amt}
            onClick={submit}
            className="w-full h-12 rounded-xl text-sm font-medium"
          >
            {busy ? "Proving…" : "Withdraw (burn)"}
          </Button>
        </div>
      </RegisterGate>
    </WalletScaffold>
  );
}
