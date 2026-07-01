import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, parseAmount, short } from "../lib/format";

// USDC on Stellar = 7 decimals (ASSET_DECIMALS).

test("parseAmount → base units", () => {
  assert.equal(parseAmount("1"), 10_000_000n);
  assert.equal(parseAmount("10.5"), 105_000_000n);
  assert.equal(parseAmount("0.0000001"), 1n); // smallest unit
  assert.equal(parseAmount(""), 0n);
  assert.equal(parseAmount("  3.25  "), 32_500_000n); // trims
});

test("parseAmount truncates beyond 7 decimals", () => {
  assert.equal(parseAmount("0.00000019"), 1n); // 8th digit dropped
});

test("fmt strips trailing zeros and round-trips parseAmount", () => {
  assert.equal(fmt(0n), "0");
  assert.equal(fmt(10_000_000n), "1");
  assert.equal(fmt(105_000_000n), "10.5");
  assert.equal(fmt(1n), "0.0000001");
  for (const s of ["0", "1", "10.5", "123.456789", "0.0000001"]) {
    assert.equal(fmt(parseAmount(s)), s);
  }
});

test("short truncates long strings, leaves short ones", () => {
  assert.equal(short("abcdefghijklmnop", 4), "abcd…mnop"); // 16 > 8 → truncated
  assert.equal(short("abc", 4), "abc"); // 3 ≤ 8 → untouched
  assert.equal(short("GA2YFLS6XYZ", 6), "GA2YFLS6XYZ"); // 11 ≤ 12 → untouched
  const long = "C".repeat(40);
  assert.equal(short(long), "CCCCCC…CCCCCC"); // default n=6
});
