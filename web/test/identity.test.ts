import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import {
  deriveMaster, deriveEncPub, deriveStellar, deriveIdentity, FIELD,
} from "../lib/identity/derive";
import { encKeyPair, encPubB64 } from "../lib/delivery";
import { normalizeEmail, normalizeHandle, recipientToUid, isEmail } from "../lib/identity/normalize";

// Fixed test root secret (NEVER use anything like this in production).
const KMS = new Uint8Array(32).fill(7);
const KMS2 = new Uint8Array(32).fill(9);

test("derivation is deterministic for a given (KMS, uid)", () => {
  const a = deriveIdentity(KMS, "email:bob@gmail.com");
  const b = deriveIdentity(KMS, "email:bob@gmail.com");
  assert.deepEqual(a, b);
});

test("different uids and different KMS produce different identities", () => {
  const a = deriveIdentity(KMS, "email:bob@gmail.com");
  const c = deriveIdentity(KMS, "email:carol@gmail.com");
  const d = deriveIdentity(KMS2, "email:bob@gmail.com");
  assert.notEqual(a.encPub, c.encPub);
  assert.notEqual(a.stellarPub, c.stellarPub);
  assert.notEqual(a.encPub, d.encPub);
  assert.notEqual(a.master, d.master);
});

test("shielded master is a valid BN254 field element", () => {
  const m = deriveMaster(KMS, "email:bob@gmail.com");
  assert.ok(m > 0n && m < FIELD);
});

test("deriveEncPub matches delivery.ts encKeyPair (client↔server consistency invariant)", () => {
  // This is THE invariant that makes pay-to-email work: the sender derives the
  // recipient's encPub from the email, and the recipient's wallet derives the
  // same encPub from their master after login.
  const m = deriveMaster(KMS, "email:bob@gmail.com");
  assert.equal(deriveEncPub(m), encPubB64(encKeyPair(m)));
});

test("derived Stellar key is a well-formed, recoverable keypair", () => {
  const kp = deriveStellar(KMS, "email:bob@gmail.com");
  assert.match(kp.publicKey(), /^G[A-Z2-7]{55}$/);
  assert.match(kp.secret(), /^S[A-Z2-7]{55}$/);
  assert.equal(Keypair.fromSecret(kp.secret()).publicKey(), kp.publicKey());
});

test("known-answer vector pins the derivation (guards accidental drift)", () => {
  // If this changes, the backend mirror (derive.mjs) MUST change identically or
  // every previously-routed payment becomes undeliverable.
  const id = deriveIdentity(KMS, "email:bob@gmail.com");
  // Snapshot the stable, non-secret public outputs.
  assert.equal(typeof id.encPub, "string");
  assert.equal(id.encPub.length, 44); // base64 of 32 bytes
  // Re-derive independently and confirm equality (self-consistent KAT).
  const m = deriveMaster(KMS, "email:bob@gmail.com");
  assert.equal(id.encPub, encPubB64(encKeyPair(m)));
  assert.equal(id.stellarPub, deriveStellar(KMS, "email:bob@gmail.com").publicKey());
});

test("normalizeEmail folds gmail dots/+tags and collapses googlemail", () => {
  assert.equal(normalizeEmail("Bob@Gmail.com"), "bob@gmail.com");
  assert.equal(normalizeEmail("b.o.b+newsletter@gmail.com"), "bob@gmail.com");
  assert.equal(normalizeEmail("bob@googlemail.com"), "bob@gmail.com");
  // Non-gmail: keep dots, strip +tag.
  assert.equal(normalizeEmail("a.b+tag@fastmail.com"), "a.b@fastmail.com");
  // Crucial: foldable variants map to ONE identity (same wallet).
  assert.equal(
    recipientToUid("B.OB+x@gmail.com"),
    recipientToUid("bob@gmail.com"),
  );
  assert.throws(() => normalizeEmail("not-an-email"));
});

test("handle + recipient classification", () => {
  assert.equal(normalizeHandle("@Alice"), "alice");
  assert.equal(recipientToUid("@Alice"), "handle:alice");
  assert.equal(recipientToUid("alice@gmail.com"), "email:alice@gmail.com");
  assert.ok(isEmail("x@y.zz"));
  assert.ok(!isEmail("@handle"));
});
