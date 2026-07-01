// Email + recipient normalization — the SINGLE source of truth for turning a
// human-typed recipient into the canonical identity string that keys the
// custodial wallet derivation. This file is imported by the client (Send UI),
// the Next API routes, and the backend (`backend/src/derive.mjs` mirrors it),
// so the *exact same* normalization must run everywhere or a sender and a
// recipient would derive different encryption keys and the payment would be
// undeliverable.
//
// IMPORTANT (security): normalization is also an attack surface — two visually
// different emails that fold to the same canonical form resolve to the SAME
// wallet. We deliberately mirror Gmail's own folding (dots + "+tag" are
// ignored by Gmail) so funds land where Gmail would route them, and we surface
// the normalized form to the sender before they confirm (see Send page).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/**
 * Canonicalize an email into the identity used for key derivation + routing.
 * - lowercases everything,
 * - strips a "+tag" suffix from the local part (all providers),
 * - for gmail.com / googlemail.com, additionally removes dots and collapses
 *   googlemail → gmail (matches Gmail's real delivery semantics).
 * Throws on an obviously invalid address.
 */
export function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (!isEmail(e)) throw new Error("invalid email address");
  const at = e.lastIndexOf("@");
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);

  // Strip +tag for every provider (the part after the first '+').
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);

  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  if (isGmail) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  if (!local) throw new Error("invalid email address (empty local part after normalization)");
  return `${local}@${domain}`;
}

/** Canonical handle: lowercase, no leading '@'. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * Map a typed recipient (email | @handle | sb1: address) to the canonical
 * identity uid used to derive their custodial wallet. `sb1:` addresses are NOT
 * identities (they're already raw keys) — callers must short-circuit those
 * before reaching here.
 */
export function recipientToUid(recipient: string): string {
  const r = recipient.trim();
  if (isEmail(r)) return `email:${normalizeEmail(r)}`;
  return `handle:${normalizeHandle(r)}`;
}
