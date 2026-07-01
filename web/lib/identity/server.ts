// Server-only glue between the Privy-authenticated client and the custodial
// backend. The browser calls our same-origin /api/identity/* routes with the
// user's Privy access token; those routes (1) VERIFY the Privy token (JWKS),
// (2) resolve the user's verified email via Privy, (3) compute the canonical
// routing identity, (4) mint a short-lived HS256 service token, and (5) forward
// to the backend. The backend authorizes on the service token, so a client can
// never act for an identity it doesn't own.
import "server-only";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { normalizeEmail, isEmail } from "@/lib/identity/normalize";

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_DELIVERY_URL || "http://localhost:8787";

const ISSUER = "xorr-next";
const AUDIENCE = "xorr-backend";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
const PRIVY_JWKS = PRIVY_APP_ID
  ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`))
  : null;

function serviceKey(): Uint8Array {
  const s = process.env.SERVICE_SECRET;
  if (!s || s.length < 16) throw new Error("SERVICE_SECRET missing/short (must match the backend)");
  return new TextEncoder().encode(s);
}

export interface RoutingIdentity {
  routingUid: string;
  emailNorm?: string;
}

/** Resolve a user's verified email/handle from their Privy DID (server-side). */
async function privyLinkedEmail(did: string): Promise<string | null> {
  const id = process.env.PRIVY_APP_ID, secret = process.env.PRIVY_APP_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(did)}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "privy-app-id": id,
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const u = await r.json();
    const accts: Array<Record<string, string>> = u.linked_accounts || [];
    const email =
      accts.find((a) => a.type === "email")?.address ||
      accts.find((a) => a.type === "google_oauth")?.email ||
      accts.find((a) => a.type === "github_oauth")?.email ||
      u.email?.address;
    return email && isEmail(email) ? email : null;
  } catch {
    return null;
  }
}

/**
 * Verify the caller's Privy access token and return their canonical routing
 * identity. Wallets are rooted in the user's VERIFIED email when present (so
 * email-addressed payments land); otherwise in the opaque Privy DID (`privy:<did>`
 * — can hold a wallet but not receive email-addressed sends). Returns null if
 * the token is missing/invalid.
 */
export async function privyIdentity(req: Request): Promise<RoutingIdentity | null> {
  if (!PRIVY_JWKS) return null;
  const authz = req.headers.get("authorization") || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return null;
  let did: string | undefined;
  try {
    const { payload } = await jwtVerify(token, PRIVY_JWKS, { issuer: "privy.io", audience: PRIVY_APP_ID });
    did = payload.sub;
  } catch {
    return null;
  }
  if (!did) return null;
  const email = await privyLinkedEmail(did);
  if (email) {
    const emailNorm = normalizeEmail(email);
    return { routingUid: `email:${emailNorm}`, emailNorm };
  }
  return { routingUid: `privy:${did}` };
}

/** Mint a short-lived service token with server-verified claims only. */
export async function mintServiceToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(serviceKey());
}

/** Call a backend identity endpoint with a freshly minted service token. */
export async function callBackend<T = unknown>(
  path: string,
  claims: Record<string, unknown>,
  body: Record<string, unknown> = {},
): Promise<{ status: number; data: T }> {
  const token = await mintServiceToken(claims);
  let r: Response;
  try {
    r = await fetch(`${BACKEND_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { status: 502, data: { error: "identity backend unreachable — is it running?" } as T };
  }
  let data: T;
  try { data = (await r.json()) as T; } catch { data = {} as T; }
  return { status: r.status, data };
}
