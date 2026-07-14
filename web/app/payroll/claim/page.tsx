"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { useAccount, useConnect, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/wallet/scaffold";
import { explorerTx } from "@/lib/config";
import {
  PAYROLL,
  PAYROLL_ABI,
  CONF_PAYROLL,
  CONF_PAYROLL_ABI,
  parseClaimHash,
  signClaimDigest,
  fromUsdc,
  type ParsedClaim,
} from "@/lib/payroll";
import { toast } from "sonner";

export default function ClaimPage() {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [parsed, setParsed] = useState<ParsedClaim | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ hash: string } | null>(null);

  useEffect(() => {
    setParsed(parseClaimHash(window.location.hash));
    setReady(true);
  }, []);

  const conf = parsed?.v === 2;
  const contract = conf ? CONF_PAYROLL : PAYROLL;
  const abi = conf ? CONF_PAYROLL_ABI : PAYROLL_ABI;

  const slot = useReadContract({
    address: contract,
    abi: abi as never,
    functionName: "getSlot",
    args: parsed ? [BigInt(parsed.id), BigInt(parsed.slot)] : undefined,
    query: { enabled: !!parsed, refetchInterval: 5000 },
  });

  // v1 slot has `amount`; v2 slot has `amountCommit` (amount comes from the link)
  const slotData = slot.data as { claimAddr: string; amount?: bigint; amountCommit?: string; claimed: boolean } | undefined;
  const amount = conf ? parsed?.amount ?? 0n : (slotData?.amount ?? 0n);
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
      let hash: Hex;
      if (parsed.v === 2) {
        const digest = (await publicClient!.readContract({
          address: CONF_PAYROLL, abi: CONF_PAYROLL_ABI, functionName: "claimDigest",
          args: [BigInt(parsed.id), BigInt(parsed.slot), address, parsed.amount!, parsed.salt!],
        })) as Hex;
        const sig = await signClaimDigest(parsed.key, digest);
        hash = await writeContractAsync({
          address: CONF_PAYROLL, abi: CONF_PAYROLL_ABI, functionName: "claim",
          args: [BigInt(parsed.id), BigInt(parsed.slot), address, parsed.amount!, parsed.salt!, sig],
        });
      } else {
        const digest = (await publicClient!.readContract({
          address: PAYROLL, abi: PAYROLL_ABI, functionName: "claimDigest",
          args: [BigInt(parsed.id), BigInt(parsed.slot), address],
        })) as Hex;
        const sig = await signClaimDigest(parsed.key, digest);
        hash = await writeContractAsync({
          address: PAYROLL, abi: PAYROLL_ABI, functionName: "claim",
          args: [BigInt(parsed.id), BigInt(parsed.slot), address, sig],
        });
      }
      await publicClient!.waitForTransactionReceipt({ hash });
      setDone({ hash });
      toast.success("Payment claimed 🎉", {
        action: { label: "Snowtrace ↗", onClick: () => window.open(explorerTx(hash), "_blank") },
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
          This link is missing or malformed. Ask the sender to re-share your XORR Payroll claim link.
        </p>
        <Link href="/" className="text-primary hover:underline text-sm">← Back to XORR</Link>
      </div>
    );

  return (
    <div className={card}>
      <div className="space-y-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          🔒 {conf ? "Confidential" : "Private"} payment · XORR Payroll
        </span>
        <h1 className="text-2xl font-semibold text-foreground">
          {slotData ? `${fromUsdc(amount)} USDC` : "…"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {conf ? "Confidential run" : "Payroll"} #{parsed.id} · slot {parsed.slot}
          {conf ? " · amount hidden on-chain" : ""}
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
            Connect any wallet to receive this payment. It’ll be sent to your connected address — the link’s
            secret authorizes only this transfer.
          </p>
          <Button onClick={connect} className="w-full h-12 rounded-xl">Connect wallet to claim</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Claim to <span className="font-mono text-foreground">{address?.slice(0, 6)}…{address?.slice(-4)}</span>.
            A front-runner can’t redirect it — the claim signature is bound to your address{conf ? " and amount" : ""}.
          </p>
          <Button onClick={claim} disabled={busy} className="w-full h-12 rounded-xl">
            {busy ? "Claiming…" : `Claim ${fromUsdc(amount)} USDC`}
          </Button>
        </>
      )}

      <Link href="/" className="block text-center text-xs text-muted-foreground hover:text-primary">
        Powered by XORR — confidential payments on Avalanche
      </Link>
    </div>
  );
}
