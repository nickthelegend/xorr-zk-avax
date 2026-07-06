import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, parseAmount, short } from "../lib/format";

// XORR on Avalanche: xUSD (eERC) = 2 decimals (ASSET_DECIMALS, matches the
// EncryptedERC contracts' `decimals: 2`).

test("parseAmount → base units", () => {
  assert.equal(parseAmount("1"), 100n);
  assert.equal(parseAmount("10.5"), 1_050n);
  assert.equal(parseAmount("0.01"), 1n); // smallest unit
  assert.equal(parseAmount(""), 0n);
  assert.equal(parseAmount("  3.25  "), 325n); // trims
});

test("parseAmount truncates beyond 2 decimals", () => {
  assert.equal(parseAmount("0.019"), 1n); // 3rd digit dropped
});

test("fmt strips trailing zeros and round-trips parseAmount", () => {
  assert.equal(fmt(0n), "0");
  assert.equal(fmt(100n), "1");
  assert.equal(fmt(1_050n), "10.5");
  assert.equal(fmt(1n), "0.01");
  for (const s of ["0", "1", "10.5", "123.45", "0.01"]) {
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
