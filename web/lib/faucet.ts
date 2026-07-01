// Testnet faucet client: add a USDC trustline (Freighter) + request mock USDC,
// and request Sepolia ETH for the connected EVM wallet.
import { Horizon, TransactionBuilder, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk";
import { sign } from "./wallet";
import { DELIVERY_URL, USDC_ISSUER, NETWORK_PASSPHRASE } from "./config";

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const usdc = () => new Asset("USDC", USDC_ISSUER);
const api = (p: string) => `${DELIVERY_URL.replace(/\/$/, "")}${p}`;

/** Whether the account exists (is created/funded) on testnet. */
export async function accountExists(pk: string): Promise<boolean> {
  try { await horizon.loadAccount(pk); return true; } catch { return false; }
}

/** Create + fund the account with test XLM via friendbot (needed before it can
 *  hold a trustline or pay fees). Idempotent: a no-op if already funded. */
export async function fundXlm(pk: string): Promise<void> {
  if (await accountExists(pk)) return;
  const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(pk)}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot failed (${r.status})`);
  // wait for the account to appear
  for (let i = 0; i < 10; i++) { if (await accountExists(pk)) return; await new Promise((s) => setTimeout(s, 1000)); }
  throw new Error("account not created yet — retry in a moment");
}

/** True if the account already trusts the demo USDC asset. */
export async function hasUsdcTrustline(pk: string): Promise<boolean> {
  try {
    const acct = await horizon.loadAccount(pk);
    return acct.balances.some(
      (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER,
    );
  } catch { return false; }
}

/** Establish the USDC trustline (Freighter-signed) so the account can hold USDC. */
export async function addUsdcTrustline(pk: string): Promise<void> {
  await fundXlm(pk); // ensure the account exists + has XLM for the fee
  const acct = await horizon.loadAccount(pk);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: usdc() }))
    .setTimeout(120)
    .build();
  const signed = await sign(tx.toXDR());
  await horizon.submitTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE) as any);
}

async function post(path: string, body: unknown) {
  const r = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `faucet error ${r.status}`);
  return j;
}

/** Mint 100 mock USDC to a Stellar address (must already trust USDC). */
export const faucetUsdc = (address: string) => post("/faucet/usdc", { address });

/** Send 0.005 Sepolia ETH to an EVM address. */
export const faucetEth = (address: string) => post("/faucet/eth", { address });
