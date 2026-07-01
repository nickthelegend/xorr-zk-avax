"use client";

import { useState } from "react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { WalletScaffold, Banner } from "@/components/wallet/scaffold";
import { RegisterGate } from "@/components/wallet/register-gate";
import { Button } from "@/components/ui/button";
import { ASSET_SYMBOL, FUJI } from "@/lib/config";
import { parseAmount } from "@/lib/format";

// Testnet faucet: get Fuji AVAX for gas (external), then self-mint test xUSD into
// your encrypted balance (owner-gated privateMint on the standalone token).
export default function FaucetPage() {
  const { address, busy, run, refresh, privateMint } = useWallet();
  const [amt, setAmt] = useState("100");

  const mint = () =>
    run("Minting test xUSD", async () => {
      await privateMint(address as `0x${string}`, parseAmount(amt));
      refresh();
    });

  return (
    <WalletScaffold
      eyebrow="Testnet tokens"
      title="Faucet"
      description="Grab tokens to try every flow. Demo-only on Fuji C-Chain."
      flow
    >
      <RegisterGate>
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <Row label="Fuji AVAX (gas) — external faucet">
            <a href={FUJI.faucet} target="_blank" rel="noreferrer">
              <Button variant="outline" className="h-9 text-xs">
                Open faucet ↗
              </Button>
            </a>
          </Row>

          <div className="border-t border-border pt-4 space-y-3">
            <Row label={`Mint test ${ASSET_SYMBOL} into your encrypted balance`}>
              <div className="flex items-center gap-2">
                <input
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  inputMode="decimal"
                  className="w-20 bg-muted/50 border border-border rounded-lg h-9 px-2 text-sm text-right tabular-nums"
                />
                <Button disabled={busy || !address} onClick={mint} className="h-9 text-xs">
                  Mint {ASSET_SYMBOL}
                </Button>
              </div>
            </Row>
            <p className="text-[11px] text-muted-foreground/70">
              Mint is owner-gated on a standalone eERC token. This works when your
              connected wallet is the token deployer; otherwise ask the issuer to
              mint to your registered address.
            </p>
          </div>

          <Banner tone="info">
            Get Fuji AVAX first for gas, then mint some {ASSET_SYMBOL} to try Pay,
            Send and Withdraw.
          </Banner>
        </div>
      </RegisterGate>
    </WalletScaffold>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 border border-border px-4 py-3">
      <span className="text-sm text-foreground/80">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
