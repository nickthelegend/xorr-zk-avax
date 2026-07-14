"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useWallet } from "@/components/stellar-wallet-provider";
import { WalletScaffold, Banner } from "@/components/wallet/scaffold";
import { RegisterGate } from "@/components/wallet/register-gate";
import { Button } from "@/components/ui/button";
import { ASSET_SYMBOL, FUJI, explorerTx } from "@/lib/config";
import { parseAmount } from "@/lib/format";
import { mintTestUsdc } from "@/lib/faucet";
import { toast } from "sonner";

// Testnet faucet on Avalanche Fuji:
//   1. Fuji AVAX for gas — external Core faucet.
//   2. Public test USDC (the eERC deposit / bridge token) — real on-chain
//      mint() to the connected wallet via viem; works for any funded wallet.
//   3. Confidential xUSD into your encrypted balance — owner-gated privateMint
//      on the standalone eERC token (deployer only).
export default function FaucetPage() {
  const { address, busy, run, refresh, privateMint } = useWallet();
  const { address: evmAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [amt, setAmt] = useState("100");
  const [usdcBusy, setUsdcBusy] = useState(false);

  const mintXusd = () =>
    run("Minting test xUSD", async () => {
      await privateMint(address as `0x${string}`, parseAmount(amt));
      refresh();
    });

  const mintUsdc = async () => {
    if (!evmAddress || !walletClient || !publicClient) {
      toast.error("Connect a Fuji wallet first");
      return;
    }
    setUsdcBusy(true);
    try {
      const hash = await mintTestUsdc(walletClient, publicClient, evmAddress, 1000);
      toast.success("Minted 1000 test USDC", {
        action: {
          label: "Snowtrace ↗",
          onClick: () => window.open(explorerTx(hash), "_blank", "noopener,noreferrer"),
        },
      });
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setUsdcBusy(false);
    }
  };

  return (
    <WalletScaffold
      eyebrow="Testnet tokens"
      title="Faucet"
      description="Grab tokens to try every flow. Live on Avalanche Fuji (C-Chain)."
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

          <div className="border-t border-border pt-4">
            <Row label="Mint public test USDC (Swap / Bridge deposit token)">
              <Button disabled={usdcBusy || !evmAddress} onClick={mintUsdc} className="h-9 text-xs">
                {usdcBusy ? "Minting…" : "Mint 1000 USDC"}
              </Button>
            </Row>
            <p className="text-[11px] text-muted-foreground/70 mt-2">
              Real on-chain mint on Fuji — anyone with a funded wallet can top up
              to try the Swap and Bridge tabs.
            </p>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <Row label={`Mint test ${ASSET_SYMBOL} into your encrypted balance`}>
              <div className="flex items-center gap-2">
                <input
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  inputMode="decimal"
                  className="w-20 bg-muted/50 border border-border rounded-lg h-9 px-2 text-sm text-right tabular-nums"
                />
                <Button disabled={busy || !address} onClick={mintXusd} className="h-9 text-xs">
                  Mint {ASSET_SYMBOL}
                </Button>
              </div>
            </Row>
            <p className="text-[11px] text-muted-foreground/70">
              Confidential mint is owner-gated on the standalone eERC token. This
              works when your connected wallet is the token deployer; otherwise ask
              the issuer to mint to your registered address.
            </p>
          </div>

          <Banner tone="info">
            Get Fuji AVAX first for gas, then mint some {ASSET_SYMBOL} or USDC to
            try Pay, Send, Swap, Bridge and Withdraw.
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
