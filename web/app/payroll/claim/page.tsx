"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { useAccount, useConnect, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/wallet/scaffold";
import { explorerTx } from "@/lib/config";
import { PAYROLL, PAYROLL_ABI, parseClaimHash, signClaimDigest, fromUsdc } from "@/lib/payroll";
import { toast } from "sonner";

type Parsed = { id: number; slot: number; key: Hex };

export default function ClaimPage() {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ hash: string; amount: string } | null>(null);

  useEffect(() => {
    setParsed(parseClaimHash(window.location.hash));
    setReady(true);
  }, []);

  const slot = useReadContract({
    address: PAYROLL,
    abi: PAYROLL_ABI,
    functionName: "getSlot",
    args: parsed ? [BigInt(parsed.id), BigInt(parsed.slot)] : undefined,
    query: { enabled: !!parsed, refetchInterval: 5000 },
  });

  const slotData = slot.data as { claimAddr: string; amount: bigint; claimed: boolean } | undefined;
  // the link is valid only if its key derives the slot's on-chain claim address
  const linkMatches =
    !!parsed && !!slotData && privateKeyToAccount(parsed.key).address.toLowerCase() === slotData.claimAddr.toLowerCase();

  async function connect() {
    try {
      await connectAsync({ connector: connectors[0] });
    } catch (e) {
      toast.error((e as Error).message.slice(0, 120));
    }
  }

  async function claim() {
    if (!parsed || !address) return;
    setBusy(true);
    try {
      // the claim key signs the on-chain digest bound to THIS payout address
      const digest = (await publicClient!.readContract({
        address: PAYROLL,
        abi: PAYROLL_ABI,
        functionName: "claimDigest",
        args: [BigInt(parsed.id), BigInt(parsed.slot), address],
      })) as Hex;
      const sig = await signClaimDigest(parsed.key, digest);

      const h = await writeContractAsync({
        address: PAYROLL,
        abi: PAYROLL_ABI,
        functionName: "claim",
        args: [BigInt(parsed.id), BigInt(parsed.slot), address, sig],
      });
      await publicClient!.waitForTransactionReceipt({ hash: h });
      setDone({ hash: h, amount: slotData ? fromUsdc(slotData.amount) : "" });
      toast.success("Payment claimed 🎉", {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(h), "_blank") },
      });
      slot.refetch();
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  const card = "w-full max-w-md mx-auto mt-10 bg-card border border-border rounded-2xl p-6 space-y-4";

  if (!ready) return <div className={card}>Loading…</div>;

  if (!parsed)
    return (
      <div className={card}>
        <h1 className="text-xl font-semibold text-foreground">Invalid claim link</h1>
        <p className="text-sm text-muted-foreground">
          This link is missing or malformed. Ask the sender to re-share your XORR Payroll
          claim link.
        </p>
        <Link href="/" className="text-primary hover:underline text-sm">
          ← Back to XORR
        </Link>
      </div>
    );

  return (
    <div className={card}>
      <div className="space-y-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          🔒 Private payment · XORR Payroll
        </span>
        <h1 className="text-2xl font-semibold text-foreground">
          {slotData ? `${fromUsdc(slotData.amount)} USDC` : "…"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Payroll #{parsed.id} · slot {parsed.slot}
        </p>
      </div>

      {slot.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading the escrow…</p>
      ) : !slotData ? (
        <Banner tone="warn">Couldn’t read this payment. Check the link and network.</Banner>
      ) : done || slotData.claimed ? (
        <Banner tone="info">
          {done ? "Claimed! " : "This payment has already been claimed. "}
          {done && (
            <a href={explorerTx(done.hash)} target="_blank" rel="noreferrer" className="text-primary underline">
              View on Snowtrace ↗
            </a>
          )}
        </Banner>
      ) : !linkMatches ? (
        <Banner tone="warn">This link doesn’t match the on-chain payment — it may be for a different run.</Banner>
      ) : !isConnected ? (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Connect any wallet to receive this payment. It’ll be sent to your connected
            address — the link’s secret authorizes only this transfer.
          </p>
          <Button onClick={connect} className="w-full h-12 rounded-xl">
            Connect wallet to claim
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Claim to{" "}
            <span className="font-mono text-foreground">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>
            . A front-runner can’t redirect it — the claim signature is bound to your address.
          </p>
          <Button onClick={claim} disabled={busy} className="w-full h-12 rounded-xl">
            {busy ? "Claiming…" : `Claim ${fromUsdc(slotData.amount)} USDC`}
          </Button>
        </>
      )}

      <Link href="/" className="block text-center text-xs text-muted-foreground hover:text-primary">
        Powered by XORR — confidential payments on Avalanche
      </Link>
    </div>
  );
}
