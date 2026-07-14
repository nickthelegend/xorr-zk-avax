// XORR Payroll — claim-link batch payroll client helpers.
//
// An employer funds a batch; each recipient gets a fresh throwaway CLAIM KEY. Only
// the claim address goes on-chain; the private key is the secret in that person's
// emailed link (carried in the URL hash — never sent to a server). To collect, the
// claim key signs the recipient's payout address and the escrow releases the funds.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { PAYROLL_ADDRESS } from "./config";

export const PAYROLL = PAYROLL_ADDRESS;

export const PAYROLL_ABI = [
  {
    type: "function",
    name: "createPayroll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "claimAddrs", type: "address[]" },
      { name: "amounts", type: "uint128[]" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "slot", type: "uint256" },
      { name: "to", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimDigest",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "slot", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getSlot",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "slot", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "claimAddr", type: "address" },
          { name: "amount", type: "uint128" },
          { name: "claimed", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPayroll",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "employer", type: "address" },
          { name: "token", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "unclaimed", type: "uint256" },
        ],
      },
    ],
  },
  { type: "function", name: "payrollCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "PayrollCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "employer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "count", type: "uint256", indexed: false },
      { name: "total", type: "uint256", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
    ],
  },
] as const;

export interface Recipient {
  email: string;
  amount: string; // human string, USDC (2 decimals)
}

export interface ClaimLink {
  email: string;
  amount: string;
  claimKey: Hex; // secret — goes in the emailed link, never on-chain
  claimAddr: `0x${string}`; // public — stored on-chain
  slot: number;
}

/** Generate a fresh claim keypair for one recipient. */
export function newClaimKey(): { key: Hex; addr: `0x${string}` } {
  const key = generatePrivateKey();
  return { key, addr: privateKeyToAccount(key).address };
}

/** Build the private claim URL for a recipient. Secret lives in the hash fragment
 *  so it is never transmitted to a server. */
export function claimUrl(origin: string, id: number, slot: number, key: Hex): string {
  return `${origin}/payroll/claim#id=${id}&slot=${slot}&k=${key}`;
}

/** A ready-to-send mailto: link the employer can click to email a claim link. */
export function claimMailto(email: string, amount: string, url: string): string {
  const subject = encodeURIComponent("You have a private payment from XORR Payroll");
  const body = encodeURIComponent(
    `You've been paid ${amount} USDC via XORR Payroll.\n\n` +
      `Open your private claim link, connect a wallet, and collect it:\n${url}\n\n` +
      `Keep this link secret — anyone with it can direct the payment.`,
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

/** Parse the claim parameters out of a claim page URL hash (#id=..&slot=..&k=0x..). */
export function parseClaimHash(hash: string): { id: number; slot: number; key: Hex } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const id = Number(p.get("id"));
  const slot = Number(p.get("slot"));
  const key = p.get("k") as Hex | null;
  if (!Number.isInteger(id) || id < 0) return null;
  if (!Number.isInteger(slot) || slot < 0) return null;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return { id, slot, key };
}

/** Sign an on-chain claim digest with the recipient's claim key (EIP-191). */
export async function signClaimDigest(key: Hex, digest: Hex): Promise<Hex> {
  const account = privateKeyToAccount(key);
  return account.signMessage({ message: { raw: digest } });
}

// USDC on this deployment uses 2 decimals (matches ASSET_DECIMALS / the faucet token).
export const toUsdc = (s: string): bigint => BigInt(Math.round((Number(s) || 0) * 100));
export const fromUsdc = (v: bigint): string => (Number(v) / 100).toFixed(2);
