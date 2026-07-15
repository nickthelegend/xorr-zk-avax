// XORR Payroll — compliance (auditor) layer.
//
// Confidential-payroll amounts are hidden on-chain behind commitments. For regulated
// use, a designated compliance officer must still be able to reconstruct the full run.
// Each slot therefore carries an ECIES cipher — the amount (+ metadata) encrypted to the
// auditor's public key — stored as opaque bytes on-chain. Only the auditor's private key
// can decrypt it; the public sees nothing.
//
// Scheme: ephemeral secp256k1 ECDH → HKDF-SHA256 → XChaCha20-Poly1305 (AEAD).
// Blob layout: ephPub(33) ‖ nonce(24) ‖ ciphertext+tag.
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bytesToHex, hexToBytes, keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { COMPLIANCE_REGISTRY_ADDRESS } from "./config";

const INFO = new TextEncoder().encode("xorr-payroll-compliance-v1");

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function kdf(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, new Uint8Array(0), INFO, 32);
}

export interface AuditorKey {
  priv: Hex; // keep secret — the compliance officer's key
  pub: Hex; // compressed (33 bytes) — shared with the employer
}

/** Generate a fresh compliance/auditor keypair. */
export function newAuditorKey(): AuditorKey {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, true); // compressed
  return { priv: bytesToHex(priv), pub: bytesToHex(pub) };
}

/** Derive the auditor public key from a private key (for pasting a key back in). */
export function auditorPubFromPriv(priv: Hex): Hex {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(priv), true));
}

/** What each slot's compliance blob wraps. */
export interface ComplianceRecord {
  email: string;
  amount: string; // human USDC string
  salt: Hex; // the commitment salt (so the auditor can independently re-derive the commit)
}

/** Encrypt a record to the auditor's public key → opaque on-chain bytes. */
export function encryptToAuditor(auditorPub: Hex, rec: ComplianceRecord): Hex {
  const eph = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(eph, true); // 33
  const shared = secp256k1.getSharedSecret(eph, hexToBytes(auditorPub)); // 33 (compressed)
  const key = kdf(shared);
  const nonce = randomBytes(24);
  const pt = new TextEncoder().encode(JSON.stringify(rec));
  const ct = xchacha20poly1305(key, nonce).encrypt(pt);
  const out = new Uint8Array(ephPub.length + nonce.length + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, ephPub.length);
  out.set(ct, ephPub.length + nonce.length);
  return bytesToHex(out);
}

/** Decrypt one slot's compliance blob with the auditor's private key. Returns null if the
 *  key doesn't match (wrong auditor / tampered blob). */
export function decryptAsAuditor(auditorPriv: Hex, blob: Hex): ComplianceRecord | null {
  try {
    const bytes = hexToBytes(blob);
    if (bytes.length < 33 + 24 + 16) return null;
    const ephPub = bytes.slice(0, 33);
    const nonce = bytes.slice(33, 57);
    const ct = bytes.slice(57);
    const shared = secp256k1.getSharedSecret(hexToBytes(auditorPriv), ephPub);
    const key = kdf(shared);
    const pt = xchacha20poly1305(key, nonce).decrypt(ct);
    return JSON.parse(new TextDecoder().decode(pt)) as ComplianceRecord;
  } catch {
    return null;
  }
}

// ── Verifiable compliance report: generation + verification ──────────────────
// The compliance key is a plain secp256k1 key — so it doubles as an EVM signer whose
// address is stored as the run's on-chain auditor, and which signs the attestation.

export const COMPLIANCE_REGISTRY = COMPLIANCE_REGISTRY_ADDRESS;

export const COMPLIANCE_REGISTRY_ABI = [
  {
    type: "function",
    name: "attest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payroll", type: "address" },
      { name: "runId", type: "uint256" },
      { name: "reportHash", type: "bytes32" },
      { name: "verifiedTotal", type: "uint128" },
      { name: "auditor", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "attestationDigest",
    stateMutability: "view",
    inputs: [
      { name: "payroll", type: "address" },
      { name: "runId", type: "uint256" },
      { name: "reportHash", type: "bytes32" },
      { name: "verifiedTotal", type: "uint128" },
      { name: "auditor", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [
      { name: "payroll", type: "address" },
      { name: "runId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "auditor", type: "address" },
          { name: "reportHash", type: "bytes32" },
          { name: "verifiedTotal", type: "uint128" },
          { name: "timestamp", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface ReportSlot {
  slot: number;
  email: string;
  amount: bigint; // base units (USDC 2dp)
  salt: Hex;
  commit: Hex; // the on-chain commitment this amount opens
}

export interface ComplianceReport {
  payroll: `0x${string}`;
  runId: number;
  chainId: number;
  auditor: `0x${string}`;
  total: bigint; // base units
  slots: ReportSlot[];
}

/** The EVM address of a compliance key — stored on-chain as the run's auditor. */
export function auditorAddress(priv: Hex): `0x${string}` {
  return privateKeyToAccount(priv).address;
}

/** keccak256 over the canonical report encoding — matches the Hardhat verifier & anyone
 *  re-deriving it from the published report. */
export function computeReportHash(r: ComplianceReport): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address, uint256, uint256, (uint256 slot,uint128 amount,bytes32 salt,bytes32 commit)[], uint128",
      ),
      [
        r.payroll,
        BigInt(r.runId),
        BigInt(r.chainId),
        r.slots.map((s) => ({ slot: BigInt(s.slot), amount: s.amount, salt: s.salt, commit: s.commit })),
        r.total,
      ],
    ),
  );
}

/** Sign the attestation digest with the auditor (compliance) key. */
export async function signAttestation(auditorPriv: Hex, digest: Hex): Promise<Hex> {
  return privateKeyToAccount(auditorPriv).signMessage({ message: { raw: digest } });
}

/** Serialize a report for publishing (bigints → decimal strings). */
export function reportToJSON(r: ComplianceReport): string {
  return JSON.stringify(
    { ...r, total: r.total.toString(), slots: r.slots.map((s) => ({ ...s, amount: s.amount.toString() })) },
    null,
    2,
  );
}

/** Parse a published report back into typed form. Throws on malformed input. */
export function reportFromJSON(s: string): ComplianceReport {
  const o = JSON.parse(s);
  if (!o || !Array.isArray(o.slots)) throw new Error("malformed report");
  return {
    payroll: o.payroll,
    runId: Number(o.runId),
    chainId: Number(o.chainId),
    auditor: o.auditor,
    total: BigInt(o.total),
    slots: (o.slots as ReportSlot[]).map((x) => ({ ...x, amount: BigInt(x.amount) })),
  };
}

export interface VerifyInput {
  report: ComplianceReport;
  amountCommit: (amount: bigint, salt: Hex) => Hex; // re-derive the commitment
  onchainCommits: Hex[]; // slot i's on-chain amountCommit
  runAuditor: `0x${string}`; // the run's on-chain auditor field
  attestation: { auditor: `0x${string}`; reportHash: Hex; verifiedTotal: bigint; timestamp: bigint };
}

export interface VerifyResult {
  ok: boolean;
  checks: { name: string; ok: boolean }[];
  slotOk: boolean[];
}

/** Independently verify a compliance report against the chain — NO secrets needed. Confirms
 *  every reported amount opens its on-chain commitment, the report hash + total match what
 *  the auditor anchored, and the anchoring auditor is the run's designated auditor. */
export function verifyReport(input: VerifyInput): VerifyResult {
  const { report, amountCommit, onchainCommits, runAuditor, attestation } = input;
  const slotOk = report.slots.map(
    (s) => amountCommit(s.amount, s.salt) === s.commit && s.commit === onchainCommits[s.slot],
  );
  const total = report.slots.reduce((a, s) => a + s.amount, 0n);
  const checks = [
    { name: "Attestation exists on-chain", ok: attestation.timestamp > 0n },
    { name: "Every amount opens its on-chain commitment", ok: slotOk.every(Boolean) },
    { name: "Report hash matches the anchored hash", ok: computeReportHash(report) === attestation.reportHash },
    { name: "Total matches the attested total", ok: total === attestation.verifiedTotal && total === report.total },
    {
      name: "Signed by the run's designated auditor",
      ok:
        attestation.auditor.toLowerCase() === runAuditor.toLowerCase() &&
        attestation.auditor.toLowerCase() === report.auditor.toLowerCase(),
    },
  ];
  return { ok: checks.every((c) => c.ok), checks, slotOk };
}
