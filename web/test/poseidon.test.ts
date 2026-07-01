import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ready, poseidon, toBytes32, fromBytes32, toHex, randomField } from "../lib/poseidon";

before(async () => {
  await ready(); // build the BN254 Poseidon
});

test("toBytes32 is 32 big-endian bytes; round-trips with fromBytes32", () => {
  for (const x of [0n, 1n, 255n, 256n, (1n << 200n) + 12345n]) {
    const b = toBytes32(x);
    assert.equal(b.length, 32);
    assert.equal(fromBytes32(b), x);
  }
  // big-endian: low value lands in the last byte
  assert.equal(toBytes32(1n)[31], 1);
  assert.equal(toBytes32(1n)[0], 0);
});

test("toHex encodes 32 bytes as 64 hex chars", () => {
  assert.equal(toHex(toBytes32(1n)).length, 64);
  assert.equal(toHex(toBytes32(255n)).endsWith("ff"), true);
});

test("randomField is distinct and within the field", () => {
  const a = randomField();
  const b = randomField();
  assert.notEqual(a, b);
  assert.ok(a >= 0n && a < 1n << 248n); // 31-byte draw
});

test("poseidon is deterministic and order-sensitive", () => {
  assert.equal(poseidon([1n, 2n]), poseidon([1n, 2n]));
  assert.notEqual(poseidon([1n, 2n]), poseidon([2n, 1n]));
  // result is a field element (fits in 32 bytes)
  assert.equal(toBytes32(poseidon([1n, 2n])).length, 32);
});
