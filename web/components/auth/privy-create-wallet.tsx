"use client";

// Client-side Privy embedded Stellar wallet — exactly the pattern requested:
//
//   import { useCreateWallet } from '@privy-io/react-auth/extended-chains';
//   const { createWallet } = useCreateWallet();
//   const { wallet } = await createWallet({ chainType: 'stellar' });
//
// Gated on NEXT_PUBLIC_PRIVY_APP_ID so it only renders when Privy is configured.
import { useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { Button } from "@/components/ui/button";
import { short } from "@/lib/format";

export function PrivyCreateStellarWallet() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { login } = useLogin();
  const { createWallet } = useCreateWallet();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return null;
  if (!ready) return <div className="h-9 w-40 rounded-xl bg-white/5 animate-pulse" />;

  const make = async () => {
    setErr(""); setBusy(true);
    try {
      const { wallet } = await createWallet({ chainType: "stellar" });
      setAddress(wallet.address);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-background/50 border border-white/10 p-4 space-y-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Privy embedded wallet
      </p>
      {!authenticated ? (
        <Button onClick={() => login()} className="h-10 text-xs font-mono uppercase tracking-widest">
          Sign in with Privy
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Signed in as {user?.email?.address || "user"}</p>
          <div className="flex gap-2">
            <Button onClick={make} disabled={busy} className="h-10 text-xs">
              {busy ? "Creating…" : "Create Stellar wallet"}
            </Button>
            <Button variant="outline" onClick={() => logout()} className="h-10 text-xs">Sign out</Button>
          </div>
          {address && (
            <p className="font-mono text-xs text-primary/90 break-all">Stellar: {short(address)}</p>
          )}
        </div>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
