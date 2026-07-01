"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@/components/stellar-wallet-provider";
import { RegisterGate } from "@/components/wallet/register-gate";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// eERC transfers are sent directly to a recipient's registered address, so
// "Receive" is simply: show your address + QR. Anyone can send you confidential
// xUSD once you're registered.
export function ReceivePanel() {
  const { address, pushLog, isRegistered } = useWallet();
  const [qr, setQr] = useState<string>("");

  useEffect(() => {
    if (!address) return setQr("");
    QRCode.toDataURL(address, {
      margin: 1,
      width: 220,
      color: { dark: "#e2a9f1ff", light: "#0a0a0aff" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [address]);

  const copy = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    toast.success("Address copied");
    pushLog("Address copied");
  };

  return (
    <RegisterGate>
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex flex-col items-center">
          <div className="relative">
            <div className="absolute -inset-6 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative rounded-2xl border border-primary/25 bg-[#101010] p-3 shadow-[0_0_40px_rgba(168,85,247,0.18)]">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="Address QR code" width={196} height={196} className="rounded-lg" />
              ) : (
                <div className="size-[196px] grid place-items-center text-xs text-muted-foreground">
                  generating…
                </div>
              )}
            </div>
          </div>
          <p className="mt-5 text-center text-xs text-muted-foreground max-w-sm leading-relaxed">
            Share this address to receive <span className="text-primary">confidential</span> xUSD.
            Every incoming transfer is encrypted on-chain — only you can decrypt your balance.
            {isRegistered ? (
              <span className="mt-1 block text-primary/80">● registered &amp; ready to receive</span>
            ) : (
              <span className="mt-1 block text-amber-400/90">● register first to receive</span>
            )}
          </p>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted/50 border border-border p-2 pl-3">
          <code className="font-mono text-xs break-all text-foreground/80 flex-1 min-w-0">
            {address || "—"}
          </code>
          <Button variant="outline" onClick={copy} disabled={!address} className="h-8 text-xs shrink-0">
            Copy
          </Button>
        </div>
      </div>
    </RegisterGate>
  );
}
