// Unit tests for lib/compliance.ts's pure helper: auditorTag. The ZK-proving
// functions (generateDisclosure/verifyDisclosure) need snarkjs + circuit
// artifacts and are exercised by hand/e2e, not here — this covers the
// deterministic, dependency-free field-encoding that binds a disclosure
// bundle to a specific auditor/session label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditorTag } from "../lib/compliance";

// BN254 scalar field order (same bound lib/disclosure-context.ts checks against).
const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

test("auditorTag is deterministic for the same label", () => {
  const a = auditorTag("KYC-session-42");
  const b = auditorTag("KYC-session-42");
  assert.equal(a, b);
});

test("auditorTag differs across labels", () => {
  const a = auditorTag("auditor-A");
  const b = auditorTag("auditor-B");
  assert.notEqual(a, b);
});

test("auditorTag is a positive field element well below the BN254 scalar field order", () => {
  const t = auditorTag("some-label");
  assert.ok(t >= 0n);
  assert.ok(t < FIELD_R);
});

test("auditorTag is sensitive to every character (no truncation collisions)", () => {
  const a = auditorTag("label");
  const b = auditorTag("labelX");
  const c = auditorTag("Label"); // case-sensitive
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("auditorTag handles the empty label without throwing", () => {
  assert.doesNotThrow(() => auditorTag(""));
  assert.equal(auditorTag(""), auditorTag(""));
});
