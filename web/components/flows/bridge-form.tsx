"use client";

import { useEffect, useState } from "react";
import * as pool from "@/lib/pool";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BridgePrep } from "@/lib/pool";
import { ASSET_SYMBOL, SHIELDED_SYMBOL, ETH_USDC, ETH_ESCROW, RELAYER_URL, TREE_DEPTH } from "@/lib/config";
import { ESCROW_ABI, USDC_ABI } from "@/lib/evm";
import { fmt, parseAmount, short } from "@/lib/format";
import { explorerTxUrl } from "@/lib/explorer";
import { celebrate } from "@/lib/confetti";
import { AmountCard, TokenChip, SwapDivider } from "@/components/wallet/fields";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { toast } from "sonner";
import Link from "next/link";

const FEE_BPS = 10; // 0.10%
type Dir = "in" | "out"; // in = Ethereum → Stellar, out = Stellar → Ethereum
type Step = "form" | "mid" | "done";
interface Done {
  dir: Dir;
  amount: bigint;
  net: bigint;
  ethTx: string;
  stellarTx: string;
  nullifier: string;
}

const label = "font-mono text-[10px] uppercase tracking-wider text-muted-foreground";

export function BridgeForm() {
  const { address, wallet, balance, busy, run, pushLog, connect } = useWallet();
  const { isConnected, address: evmAddr } = useAccount();
  const { data: evmBal } = useBalance({ address: evmAddr });

  const [dir, setDir] = useState<Dir>("in");
  const [step, setStep] = useState<Step>("form");
  const [amt, setAmt] = useState("5");
  const [nonce, setNonce] = useState("1");
  const [busyEth, setBusyEth] = useState(false);
  const [lockTx, setLockTx] = useState("");
  const [prep, setPrep] = useState<BridgePrep | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const { writeContractAsync } = useWriteContract();

  // Live ETH deposit-tree status: the relayer commits every Sepolia lock to a
  // keccak256 Merkle tree and posts its root to the Stellar bridge, which gates
  // each mint on an on-chain membership proof. Poll the relayer to surface it.
  const [ethTree, setEthTree] = useState<{ ethRoot: string | null; ethDeposits: number; bridgeId: string } | null>(null);
  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const r = await fetch(`${RELAYER_URL}/health`, { cache: "no-store" });
        const d = await r.json();
        if (on && d?.ok) setEthTree({ ethRoot: d.ethRoot ?? null, ethDeposits: d.ethDeposits ?? 0, bridgeId: d.bridgeId });
      } catch { /* relayer offline — strip stays hidden */ }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => { on = false; clearInterval(id); };
  }, []);

  const gross = parseAmount(amt);
  const fee = (gross * BigInt(FEE_BPS)) / 10000n;
  const net = gross - fee;

  // reverse needs a spendable shielded note ≥ the amount
  const burnNote = (wallet?.notes ?? []).find(
    (n) => !n.spent && n.leafIndex != null && BigInt(n.amount) >= gross,
  );

  const steps =
    dir === "in"
      ? ["Lock on Ethereum", "Relayer Merkle root", "Claim on Stellar"]
      : ["Burn xUSDC on Stellar", "Relayer attests", "Release on Ethereum"];
  const activeIdx = step === "form" ? 0 : step === "mid" ? 1 : 2;

  const flip = () => {
    setDir((d) => (d === "in" ? "out" : "in"));
    reset();
  };
  const reset = () => {
    setStep("form");
    setDone(null);
    setLockTx("");
    setPrep(null);
  };

  // Mint test USDC (open faucet) to the connected EVM wallet.
  const faucet = async () => {
    if (!isConnected) { toast.error("Connect your EVM wallet first"); return; }
    setBusyEth(true);
    try {
      const hash = await writeContractAsync({ address: ETH_USDC as `0x${string}`, abi: USDC_ABI, functionName: "mint", args: [evmAddr as `0x${string}`, 100_000_000n], chain: undefined, account: undefined });
      toast.success("Minted 100 test USDC", { description: short(hash) });
      pushLog(`Faucet: +100 ${ASSET_SYMBOL} → ${short(evmAddr || "")}`);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      toast.error(err.shortMessage || err.message || "mint failed");
    } finally {
      setBusyEth(false);
    }
  };

  // ── Forward: prove + lock real USDC on Ethereum → relayer mints on Stellar ──
  const lock = async () => {
    if (!wallet) { toast.error("Wallet not ready"); return; }
    setBusyEth(true);
    try {
      // generate the shielded note + Groth16 proof (only we hold the secrets)
      const p = await pool.prepareBridgeIn(wallet, net, pushLog);
      setPrep(p);
      const ethAmt = gross / 10n; // 7-dec Stellar amount → 6-dec USDC
      pushLog("Approving USDC…");
      await writeContractAsync({ address: ETH_USDC as `0x${string}`, abi: USDC_ABI, functionName: "approve", args: [ETH_ESCROW as `0x${string}`, ethAmt], chain: undefined, account: undefined });
      pushLog("Locking USDC into escrow…");
      const hash = await writeContractAsync({ address: ETH_ESCROW as `0x${string}`, abi: ESCROW_ABI, functionName: "lock", args: [ethAmt, p.commitment as `0x${string}`], chain: undefined, account: undefined });
      setLockTx(hash);
      setStep("mid");
      toast.success("Locked USDC on Ethereum", {
        description: short(hash),
        action: { label: "Etherscan ↗", onClick: () => window.open(`https://sepolia.etherscan.io/tx/${hash}`, "_blank", "noopener,noreferrer") },
        duration: 9000,
      });
      pushLog(`Locked ${fmt(gross)} ${ASSET_SYMBOL} on Sepolia · ${short(hash)}`);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      toast.error(err.shortMessage || err.message || "lock failed");
      pushLog(`⚠ ${err.shortMessage || err.message}`);
    } finally {
      setBusyEth(false);
    }
  };

  const claim = async () => {
    if (!prep || !wallet) return;
    await run("Claiming xUSDC (relayer + ZK)", async () => {
      pushLog("Relayer verifying lock + submitting bridge_in…");
      const r = await fetch(`${RELAYER_URL}/bridge-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ethTx: lockTx, commitment: prep.commitment, amount: prep.amount, oldRoot: prep.oldRoot, newRoot: prep.newRoot, proof: prep.proof }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "relayer error");
      pool.recordBridgedNote(wallet, prep, pushLog);
      setDone({ dir: "in", amount: gross, net, ethTx: lockTx, stellarTx: data.stellarTx, nullifier: prep.commitment });
      setStep("done");
      celebrate();
    });
  };

  // ── Reverse: burn xUSDC on Stellar (ZK) → relayer releases real USDC on Ethereum ─
  // One real action: generate the Withdraw proof that burns the note to the bridge
  // sink (value-conserving), hand it to the relayer which submits the burn AND
  // calls the escrow's relayer-gated release(to, amount, nullifier) on Sepolia.
  const bridgeOut = async () => {
    if (!burnNote) { toast.error(`No shielded ${SHIELDED_SYMBOL} note ≥ amount — deposit first`); return; }
    if (!isConnected || !evmAddr) { toast.error("Connect your EVM wallet to receive the released USDC"); return; }
    if (!wallet) return;
    await run("Bridging out (ZK burn + release)", async () => {
      const prep = await pool.prepareBridgeOut(wallet, burnNote, net, pushLog);
      setStep("mid");
      pushLog("Relayer burning on Stellar + releasing USDC on Ethereum…");
      const r = await fetch(`${RELAYER_URL}/bridge-out`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: prep.recipient, amount: prep.amount, nullifier: prep.nullifier,
          changeCommitment: prep.changeCommitment, oldRoot: prep.oldRoot, newRoot: prep.newRoot,
          proof: prep.proof, ethRecipient: evmAddr,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "relayer error");
      pool.recordBridgeOut(wallet, burnNote, prep);
      setDone({ dir: "out", amount: gross, net, ethTx: data.ethTx, stellarTx: data.stellarTx, nullifier: prep.nullifier });
      setStep("done");
      celebrate();
      toast.success(`Released ${fmt(net)} ${ASSET_SYMBOL} on Ethereum`, {
        description: short(data.ethTx),
        action: { label: "Etherscan ↗", onClick: () => window.open(`https://sepolia.etherscan.io/tx/${data.ethTx}`, "_blank", "noopener,noreferrer") },
        duration: 9000,
      });
      pushLog(`🔥 Burned on Stellar · released ${fmt(net)} ${ASSET_SYMBOL} on Ethereum · ${short(data.ethTx)}`);
    });
  };

  // ── Balance footers (only when that wallet is connected) ──────────────────
  const evmFooter = isConnected ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-primary" /> {short(evmAddr || "")} ·{" "}
      <b className="text-foreground">{evmBal ? `${Number(evmBal.formatted).toFixed(4)} ${evmBal.symbol}` : "…"}</b>
    </span>
  ) : (
    <ConnectButton label="Connect EVM wallet" />
  );
  const stellarFooter = address ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-primary" /> shielded ·{" "}
      <b className="text-foreground">{fmt(balance)} {SHIELDED_SYMBOL}</b>
    </span>
  ) : (
    <button onClick={connect} className="text-[11px] text-primary hover:underline">Connect Stellar wallet</button>
  );

  // direction-aware token cards
  const ethCard = (to: boolean) => (
    <AmountCard
      accent={to}
      label={`${to ? "To" : "From"} · Ethereum Sepolia`}
      right={!to ? <button type="button" onClick={faucet} disabled={busyEth || !isConnected} className="text-[11px] text-primary hover:underline disabled:opacity-50">Claim USDC Faucet</button> : undefined}
      token={<TokenChip symbol={ASSET_SYMBOL} color="#2775ca" />}
      value={to ? fmt(net) : amt}
      onChange={!to && step === "form" ? setAmt : undefined}
      readOnly={to || step !== "form"}
      footer={evmFooter}
    />
  );
  const stellarCard = (to: boolean) => (
    <AmountCard
      accent={to}
      label={`${to ? "To" : "From"} · Stellar Testnet`}
      token={<TokenChip symbol={SHIELDED_SYMBOL} primary />}
      value={to ? fmt(net) : amt}
      onChange={!to && step === "form" ? setAmt : undefined}
      readOnly={to || step !== "form"}
      footer={stellarFooter}
    />
  );

  return (
    <div className="space-y-4">
      {/* progress stepper */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1 rounded-full ${i <= activeIdx ? "bg-primary" : "bg-white/10"}`} />
            <div className={`mt-1.5 text-[10px] ${i <= activeIdx ? "text-primary" : "text-muted-foreground"}`}>{s}</div>
          </div>
        ))}
      </div>

      {/* Live ETH deposit-tree → Stellar status (the cross-chain root we post on-chain) */}
      {dir === "in" && ethTree && (
        <a
          href={`https://stellar.expert/explorer/testnet/contract/${ethTree.bridgeId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2 text-[11px] hover:bg-primary/10 transition-colors"
          title="Every Ethereum deposit is committed to a keccak256 Merkle tree whose root is posted to Stellar — each mint is verified against it on-chain."
        >
          <span className="inline-flex items-center gap-1.5 font-medium text-primary/90">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            ETH deposit tree → Stellar
          </span>
          <span className="font-mono text-muted-foreground">
            {ethTree.ethDeposits} deposits · {ethTree.ethRoot ? `root ${ethTree.ethRoot.slice(0, 6)}…${ethTree.ethRoot.slice(-4)}` : "syncing…"} ↗
          </span>
        </a>
      )}

      {step !== "done" ? (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-1.5">
          {/* FROM (direction-aware) */}
          {dir === "in" ? ethCard(false) : stellarCard(false)}

          {/* flip direction */}
          <SwapDivider onClick={step === "form" ? flip : undefined} />

          {/* TO (direction-aware) */}
          {dir === "in" ? stellarCard(true) : ethCard(true)}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
            <span>{dir === "in" ? "USDC → private xUSDC" : "private xUSDC → USDC"}</span>
            <span>fee {(FEE_BPS / 100).toFixed(2)}% · {fmt(fee)} {dir === "in" ? ASSET_SYMBOL : SHIELDED_SYMBOL}</span>
          </div>

          {/* action */}
          {dir === "in" ? (
            step === "form" ? (
              <Button disabled={!isConnected || busyEth || gross <= 0n} onClick={lock} className="w-full h-12 mt-2 rounded-xl text-sm font-medium">
                {busyEth ? "Locking on Ethereum…" : isConnected ? `Lock ${amt} ${ASSET_SYMBOL}` : "Connect EVM wallet first"}
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 text-xs text-primary/90">
                  ✓ Relayer posted the Merkle root. Ready to claim {SHIELDED_SYMBOL} on Stellar.
                </div>
                <Button disabled={busy || !address} onClick={claim} className="w-full h-12 rounded-xl text-sm font-medium bg-gradient-to-r from-primary to-[#7c3aed] text-black">
                  {busy ? "Proving & claiming…" : `✦ Claim ${SHIELDED_SYMBOL} on Stellar (ZK)`}
                </Button>
                {!address && <p className="text-[11px] text-muted-foreground">Connect Stellar or sign in to claim.</p>}
              </div>
            )
          ) : step === "form" ? (
            <>
              <Button disabled={busy || !address || !isConnected || gross <= 0n || !burnNote} onClick={bridgeOut} className="w-full h-12 mt-2 rounded-xl text-sm font-medium">
                {busy ? "Bridging out (ZK)…" : !address ? "Connect Stellar wallet first" : !isConnected ? "Connect EVM wallet to receive" : `🔥 Bridge out ${amt} ${SHIELDED_SYMBOL}`}
              </Button>
              {address && !burnNote && gross > 0n && (
                <p className="text-[11px] text-amber-400/90">No shielded note ≥ {amt} {SHIELDED_SYMBOL} — deposit first.</p>
              )}
              {!isConnected && <p className="text-[11px] text-muted-foreground">Connect your EVM wallet to receive the released USDC.</p>}
            </>
          ) : (
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 text-xs text-primary/90 flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              Note burned on Stellar (ZK) — relayer releasing {ASSET_SYMBOL} on Ethereum…
            </div>
          )}

          {/* nonce (advanced, forward only) */}
          {dir === "in" && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Advanced</summary>
              <div className="mt-2 space-y-1">
                <span className={label}>Ethereum lock nonce</span>
                <Input value={nonce} onChange={(e) => setNonce(e.target.value)} className="h-9 bg-muted/50 border-border" />
              </div>
            </details>
          )}

          {/* ZK stat chips */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { k: "Privacy set", v: `2^${TREE_DEPTH}` },
              { k: "Proof", v: "Groth16" },
              { k: "Fee", v: `${(FEE_BPS / 100).toFixed(1)}%` },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-border bg-muted/50 p-2.5 text-center">
                <div className="text-sm font-semibold">{s.v}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.k}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        done && (
          <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/15 grid place-items-center text-primary text-2xl">✓</div>
            <div>
              <h3 className="text-xl font-bold">Bridge Completed!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {done.dir === "in" ? (
                  <>Your USDC is now private <b className="text-primary">{SHIELDED_SYMBOL}</b> on Stellar — no on-chain link between deposit and claim.</>
                ) : (
                  <>Your shielded <b className="text-primary">{SHIELDED_SYMBOL}</b> was burned on Stellar and released as <b className="text-foreground">{ASSET_SYMBOL}</b> on Ethereum.</>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border divide-y divide-border text-left text-sm">
              <Row k="Amount" v={`${fmt(done.amount)} ${done.dir === "in" ? ASSET_SYMBOL : SHIELDED_SYMBOL}`} />
              <Row k="You received" v={`${fmt(done.net)} ${done.dir === "in" ? SHIELDED_SYMBOL : ASSET_SYMBOL}`} primary />
              {done.dir === "in" ? (
                <>
                  <Row k="Ethereum Lock Tx" v={<TxLink label={short(done.ethTx)} href={`https://sepolia.etherscan.io/tx/${done.ethTx}`} />} />
                  <Row k="Stellar Claim Tx" v={<TxLink label={short(done.stellarTx)} href={explorerTxUrl(done.stellarTx)} />} />
                </>
              ) : (
                <>
                  <Row k="Stellar Burn (ZK)" v={<TxLink label={short(done.stellarTx)} href={explorerTxUrl(done.stellarTx)} />} />
                  <Row k="Ethereum Release Tx" v={<TxLink label={short(done.ethTx)} href={`https://sepolia.etherscan.io/tx/${done.ethTx}`} />} />
                </>
              )}
              <Row k="ZK Nullifier Hash" v={<span className="font-mono text-[10px] break-all">{done.nullifier.slice(0, 24)}…</span>} />
            </div>
            <Button onClick={reset} className="w-full h-11 rounded-xl text-sm font-medium">Bridge Again</Button>
          </div>
        )
      )}
    </div>
  );
}

function Row({ k, v, primary }: { k: string; v: React.ReactNode; primary?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-muted-foreground text-xs">{k}</span>
      <span className={primary ? "font-semibold text-primary" : "font-medium"}>{v}</span>
    </div>
  );
}
function TxLink({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">
      {label} ↗
    </a>
  );
}
