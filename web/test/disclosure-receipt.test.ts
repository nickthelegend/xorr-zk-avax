import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_R,
  contextTag,
  randomNonce,
  contextMatches,
  type ReceiptContext,
} from "../lib/disclosure-context";

const CTX: ReceiptContext = {
  authority: "KYC Provider",
  purpose: "identity-verification",
  nonce: "0xdeadbeefcafebabe",
};

test("contextTag is deterministic and a valid BN254 field element", () => {
  const a = contextTag(CTX);
  const b = contextTag({ ...CTX });
  assert.equal(a, b, "same context → same tag");
  assert.ok(a > 0n, "tag is non-zero");
  assert.ok(a < FIELD_R, "tag is reduced below the scalar field order");
});

test("contextTag changes when ANY field changes (no field is ignored)", () => {
  const base = contextTag(CTX);
  assert.notEqual(base, contextTag({ ...CTX, authority: "Evil Corp" }), "authority is bound");
  assert.notEqual(base, contextTag({ ...CTX, purpose: "aml-check" }), "purpose is bound");
  assert.notEqual(base, contextTag({ ...CTX, nonce: "0x00" }), "nonce is bound");
});

test("randomNonce is 0x + 32 hex chars and unique across calls", () => {
  const n1 = randomNonce();
  const n2 = randomNonce();
  assert.match(n1, /^0x[0-9a-f]{32}$/, "shape is 0x + 16 bytes");
  assert.notEqual(n1, n2, "two nonces differ");
});

test("contextMatches passes only when signals re-derive from the bound context + note", () => {
  const commitment = "12345678901234567890123456789";
  const amount = "5000000";
  const goodSignals = [commitment, amount, contextTag(CTX).toString()];

  assert.equal(contextMatches(goodSignals, CTX, commitment, amount), true, "honest receipt verifies");

  // Tampering the declared authority breaks the re-derivation (the proof can't be re-bound).
  const tamperedCtx = { ...CTX, authority: "Someone Else" };
  assert.equal(contextMatches(goodSignals, tamperedCtx, commitment, amount), false, "swapped authority detected");

  // Lying about the amount is caught.
  assert.equal(contextMatches(goodSignals, CTX, commitment, "9999999"), false, "amount mismatch detected");

  // Lying about which note is caught.
  assert.equal(contextMatches(goodSignals, CTX, "999", amount), false, "commitment mismatch detected");

  // Missing signals never pass.
  assert.equal(contextMatches(undefined, CTX, commitment, amount), false, "missing signals rejected");
});
