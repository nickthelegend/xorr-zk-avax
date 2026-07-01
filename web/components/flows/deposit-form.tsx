"use client";

import { useState } from "react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Button } from "@/components/ui/button";
import { ASSET_SYMBOL } from "@/lib/config";
import { parseAmount } from "@/lib/format";
import { AmountCard, TokenChip } from "@/components/wallet/fields";
import { RegisterGate } from "@/components/wallet/register-gate";

// Standalone eERC: "Deposit" mints fresh confidential xUSD into your encrypted
// balance (privateMint). The amount is encrypted on-chain — only a zk proof and
// ciphertext are posted. In a standalone token, mint is owner-gated, so this is
// the issuer/faucet path for the demo token.
export function DepositForm() {
  const { address, busy, run, refresh, privateMint } = useWallet();
  const [amt, setAmt] = useState("");

  const submit = () =>
    run("Generating mint proof", async () => {
      await privateMint(address as `0x${string}`, parseAmount(amt));
      setAmt("");
      refresh();
    });

  return (
    <RegisterGate>
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="font-semibold text-foreground">Mint confidential {ASSET_SYMBOL}</h3>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            A zk-SNARK proves the mint is well-formed; the amount is encrypted with
            your BabyJubJub key and only ciphertext lands on-chain. Your balance is
            never revealed — you decrypt it locally.
          </p>

          <div className="mt-5">
            <AmountCard
              label="Amount to mint"
              token={<TokenChip symbol={ASSET_SYMBOL} primary />}
              value={amt}
              onChange={setAmt}
              placeholder="0.0"
              right={
                <button
                  type="button"
                  onClick={() => setAmt("100")}
                  className="text-[11px] text-primary hover:underline"
                >
                  +100 {ASSET_SYMBOL}
                </button>
              }
            />
          </div>

          <Button
            disabled={busy || !amt || !address}
            onClick={submit}
            className="mt-4 w-full h-12 rounded-xl text-sm font-medium"
          >
            {busy ? "Proving…" : "Mint privately"}
          </Button>
          <p className="mt-3 text-[11px] text-muted-foreground/80 leading-relaxed">
            Mint is owner-gated on a standalone eERC token. If your wallet is the
            deployer you can self-mint test {ASSET_SYMBOL}; otherwise ask the issuer
            to mint to your registered address.
          </p>
        </div>
      </div>
    </RegisterGate>
  );
}
