"use client";

import { useState, type ReactNode } from "react";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/wallet/scaffold";
import { FUJI } from "@/lib/config";

// Gates confidential actions behind the eERC lifecycle:
//   configured → connected → initialized → registered → decryption key loaded.
// Renders a premium inline prompt for whichever step is missing, else children.
export function RegisterGate({ children }: { children: ReactNode }) {
  const {
    configured,
    address,
    connect,
    isInitialized,
    isRegistered,
    keyLoaded,
    register,
    generateKey,
  } = useWallet();
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <Banner tone="warn">
        eERC not configured — set <code>NEXT_PUBLIC_EERC_ADDRESS</code> in{" "}
        <code>web/.env.local</code> to your deployed EncryptedERC address, then
        restart the dev server.
      </Banner>
    );
  }

  if (!address) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 text-center">
        <h3 className="font-semibold text-foreground">Connect your wallet</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          Connect a Fuji-funded wallet to continue.{" "}
          <a className="text-primary underline" href={FUJI.faucet} target="_blank" rel="noreferrer">
            Get test AVAX ↗
          </a>
        </p>
        <Button onClick={connect} className="font-mono text-[11px] uppercase tracking-widest">
          Connect wallet
        </Button>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 flex items-center gap-3">
        <span className="size-3 rounded-full bg-primary animate-pulse" />
        <span className="text-sm text-muted-foreground font-mono">
          Initializing eERC &amp; loading circuits…
        </span>
      </div>
    );
  }

  async function doRegister() {
    setBusy(true);
    try {
      await register();
      await generateKey();
    } finally {
      setBusy(false);
    }
  }

  async function doKey() {
    setBusy(true);
    try {
      await generateKey();
    } finally {
      setBusy(false);
    }
  }

  if (!isRegistered) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <h3 className="font-semibold text-foreground">One-time registration</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4 leading-relaxed">
          Register a BabyJubJub public key so you can hold and receive encrypted
          {" "}xUSD. This is a client-side zk proof — your keys never leave the browser.
        </p>
        <Button onClick={doRegister} disabled={busy} className="w-full h-12 rounded-xl">
          {busy ? "Registering…" : "Register with XORR"}
        </Button>
      </div>
    );
  }

  if (!keyLoaded) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <h3 className="font-semibold text-foreground">Unlock your balance</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4 leading-relaxed">
          Sign a message to derive your decryption key. It&apos;s deterministic
          from your wallet — no server ever sees it.
        </p>
        <Button onClick={doKey} disabled={busy} className="w-full h-12 rounded-xl">
          {busy ? "Signing…" : "Generate decryption key"}
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
