import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encKeyPair,
  encPubB64,
  encryptTo,
  decryptBlob,
  encodeAddress,
  parseAddress,
  routeKey,
  myShieldedAddress,
} from "../lib/delivery";

// The delivery layer never needs Poseidon — pure NaCl box + sha256 + the
// deterministic X25519 keypair derived from the wallet master.

test("encKeyPair is deterministic from the master and distinct across masters", () => {
  const a = encKeyPair(123n);
  const b = encKeyPair(123n);
  assert.deepEqual([...a.publicKey], [...b.publicKey]);
  assert.deepEqual([...a.secretKey], [...b.secretKey]);
  const c = encKeyPair(124n);
  assert.notDeepEqual([...a.publicKey], [...c.publicKey]);
});

test("encryptTo → decryptBlob round-trips the payload for the recipient", () => {
  const kp = encKeyPair(7n);
  const payload = { amount: "100", blinding: "42", sk: "9" };
  const blob = encryptTo(encPubB64(kp), payload);
  const out = decryptBlob<typeof payload>({ ...blob }, kp.secretKey);
  assert.deepEqual(out, payload);
});

test("a blob for someone else does not open (returns null)", () => {
  const me = encKeyPair(7n);
  const someoneElse = encKeyPair(8n);
  const blob = encryptTo(encPubB64(me), { secret: 1 });
  assert.equal(decryptBlob(blob, someoneElse.secretKey), null);
});

test("each encryption uses a fresh ephemeral key (ciphertext is non-deterministic)", () => {
  const pub = encPubB64(encKeyPair(7n));
  const a = encryptTo(pub, { x: 1 });
  const b = encryptTo(pub, { x: 1 });
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.ephemeralPub, b.ephemeralPub);
});

test("address encode/parse round-trips and rejects malformed input", () => {
  const addr = encodeAddress("AbC123+/=");
  assert.equal(addr, "sb1:AbC123+/=");
  assert.equal(parseAddress(addr).encPub, "AbC123+/=");
  assert.throws(() => parseAddress("not-an-address"));
});

test("routeKey is a stable hex(sha256) of the address key", () => {
  const pub = encPubB64(encKeyPair(1n));
  assert.equal(routeKey(pub), routeKey(pub));
  assert.equal(routeKey(pub).length, 64);
  assert.notEqual(routeKey(pub), routeKey(encPubB64(encKeyPair(2n))));
});

test("myShieldedAddress has the sb1: form", () => {
  assert.match(myShieldedAddress(5n), /^sb1:.+/);
});
