// XORR Payroll — claim-link batch payroll client helpers.
//
// An employer funds a batch; each recipient gets a fresh throwaway CLAIM KEY. Only
// the claim address goes on-chain; the private key is the secret in that person's
// emailed link (carried in the URL hash — never sent to a server). To collect, the
// claim key signs the recipient's payout address and the escrow releases the funds.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, encodeAbiParameters, type Hex } from "viem";
import { PAYROLL_ADDRESS, CONF_PAYROLL_ADDRESS } from "./config";

export const PAYROLL = PAYROLL_ADDRESS;
export const CONF_PAYROLL = CONF_PAYROLL_ADDRESS;

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

// ── ConfidentialPayroll (v2) ABI + helpers ───────────────────────────────────
export const CONF_PAYROLL_ABI = [
  {
    type: "function",
    name: "createRun",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "claimAddrs", type: "address[]" },
      { name: "commits", type: "bytes32[]" },
      { name: "auditorCiphers_", type: "bytes[]" },
      { name: "pool", type: "uint128" },
      { name: "auditor", type: "address" },
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
      { name: "amount", type: "uint128" },
      { name: "salt", type: "bytes32" },
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
      { name: "amount", type: "uint128" },
      { name: "salt", type: "bytes32" },
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
          { name: "amountCommit", type: "bytes32" },
          { name: "claimed", type: "bool" },
        ],
      },
    ],
  },
  { type: "function", name: "slotCount", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "auditorCipher", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }, { name: "slot", type: "uint256" }], outputs: [{ type: "bytes" }] },
  { type: "function", name: "runCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Fresh 32-byte commitment salt. */
export function newSalt(): Hex {
  return generatePrivateKey(); // 32 random bytes, hex — perfect as a salt
}

/** keccak256(abi.encode(uint128 amount, bytes32 salt)) — matches the contract. */
export function amountCommit(amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint128" }, { type: "bytes32" }], [amount, salt]),
  );
}

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

/** Confidential (v2) claim URL — also carries the amount + commitment salt (revealed
 *  only to this recipient) so the on-chain commitment can be opened at claim time. */
export function confClaimUrl(
  origin: string,
  id: number,
  slot: number,
  key: Hex,
  amountUnits: bigint,
  salt: Hex,
): string {
  return `${origin}/payroll/claim#v=2&id=${id}&slot=${slot}&amt=${amountUnits}&salt=${salt}&k=${key}`;
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

export interface ParsedClaim {
  v: 1 | 2;
  id: number;
  slot: number;
  key: Hex;
  amount?: bigint; // v2 only — the (private) amount revealed at claim
  salt?: Hex; // v2 only — the commitment salt
}

/** Parse the claim parameters out of a claim page URL hash. v1: #id=..&slot=..&k=0x..
 *  v2 (confidential): #v=2&id=..&slot=..&amt=..&salt=0x..&k=0x.. */
export function parseClaimHash(hash: string): ParsedClaim | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const id = Number(p.get("id"));
  const slot = Number(p.get("slot"));
  const key = p.get("k") as Hex | null;
  if (!Number.isInteger(id) || id < 0) return null;
  if (!Number.isInteger(slot) || slot < 0) return null;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  if (p.get("v") === "2") {
    const salt = p.get("salt") as Hex | null;
    const amtStr = p.get("amt");
    if (!salt || !/^0x[0-9a-fA-F]{64}$/.test(salt)) return null;
    if (!amtStr || !/^\d+$/.test(amtStr)) return null;
    return { v: 2, id, slot, key, amount: BigInt(amtStr), salt };
  }
  return { v: 1, id, slot, key };
}

/** Sign an on-chain claim digest with the recipient's claim key (EIP-191). */
export async function signClaimDigest(key: Hex, digest: Hex): Promise<Hex> {
  const account = privateKeyToAccount(key);
  return account.signMessage({ message: { raw: digest } });
}

// USDC on this deployment uses 2 decimals (matches ASSET_DECIMALS / the faucet token).
export const toUsdc = (s: string): bigint => BigInt(Math.round((Number(s) || 0) * 100));
export const fromUsdc = (v: bigint): string => (Number(v) / 100).toFixed(2);
