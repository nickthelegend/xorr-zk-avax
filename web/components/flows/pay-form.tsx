"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useWallet } from "@/components/stellar-wallet-provider";
import { Banner } from "@/components/wallet/scaffold";
import { RegisterGate } from "@/components/wallet/register-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSET_SYMBOL } from "@/lib/config";
import { parseAmount } from "@/lib/format";
import { AmountCard, TokenChip } from "@/components/wallet/fields";
import { toast } from "sonner";

const labelCls = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";
const inputCls = "bg-muted/50 border-border h-11";

export function PayForm() {
  const { busy, run, parsedBalance, balance, decimals, isAddressRegistered, privateTransfer, refresh } =
    useWallet();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");

  const validAddr = isAddress(to.trim());

  const submit = () =>
    run("Generating private payment proof", async () => {
      const recipient = to.trim() as `0x${string}`;
      const value = parseAmount(amt);
      if (value <= 0n) throw new Error("Enter an amount greater than zero");
      if (value > balance) throw new Error("Insufficient encrypted balance");
      const { isRegistered } = await isAddressRegistered(recipient);
      if (!isRegistered)
        throw new Error("Recipient is not registered with eERC — they must register first");
      await privateTransfer(recipient, value);
      setAmt("");
      refresh();
      toast.success("Private transfer sent");
    });

  const canSend = !busy && !!amt && validAddr;

  return (
    <RegisterGate>
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            A confidential transfer: the amount and the sender↔receiver link stay
            hidden on-chain. Your wallet generates a zk-SNARK client-side; the
            contract only verifies it. Spendable balance:{" "}
            <b className="text-foreground">{parsedBalance} {ASSET_SYMBOL}</b>.
          </p>

          {to.trim().length > 0 && !validAddr && (
            <div className="mt-4">
              <Banner tone="warn">Enter a valid 0x recipient address.</Banner>
            </div>
          )}

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label className={labelCls}>Recipient — registered eERC address (0x…)</Label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={inputCls}
                placeholder="0x…"
              />
            </div>
            <AmountCard
              label="Amount"
              right={
                <button
                  type="button"
                  onClick={() => setAmt(parsedBalance)}
                  className="text-[11px] text-primary hover:underline"
                >
                  Max · {parsedBalance} {ASSET_SYMBOL}
                </button>
              }
              token={<TokenChip symbol={ASSET_SYMBOL} primary />}
              value={amt}
              onChange={setAmt}
              placeholder="0.0"
            />
            <Button
              disabled={!canSend}
              onClick={submit}
              className="w-full h-12 rounded-xl text-sm font-medium"
            >
              {busy ? "Proving…" : "Send privately"}
            </Button>
          </div>
        </div>
      </div>
    </RegisterGate>
  );
}
