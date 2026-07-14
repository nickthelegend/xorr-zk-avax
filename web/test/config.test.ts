import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUJI,
  EERC_ADDRESS,
  REGISTRAR_ADDRESS,
  BABYJUBJUB_ADDRESS,
  VERIFIERS,
  USDC_ADDRESS,
  XAV_ADDRESS,
  AMM_ADDRESS,
  BRIDGE_ADDRESS,
  ASSET_DECIMALS,
  ASSET_SYMBOL,
  isConfigured,
  eercAddressSet,
  explorerTx,
} from "../lib/config";

// The top code-review finding: the app must default to Avalanche Fuji + eERC,
// never Stellar. These assertions lock the defaults to the deployed Fuji
// contracts (contracts/EncryptedERC/deployments/fuji.json + fuji-defi.json).

test("network defaults to Avalanche Fuji (43113), not Stellar", () => {
  assert.equal(FUJI.chainId, 43113);
  assert.match(FUJI.rpc, /avax-test\.network/);
  assert.match(FUJI.explorer, /snowtrace/);
});

test("isConfigured() is true out of the box (eERC address is live)", () => {
  assert.equal(isConfigured(), true);
  assert.equal(eercAddressSet(), true);
  assert.notEqual(
    EERC_ADDRESS,
    "0x0000000000000000000000000000000000000000",
  );
});

test("core eERC addresses match the deployed Fuji stack", () => {
  assert.equal(EERC_ADDRESS, "0x320C389607d109B12836D6B8F507C7e87783cf82");
  assert.equal(REGISTRAR_ADDRESS, "0x098561944b2437288Fe98d3F5FA824868899104a");
  assert.equal(BABYJUBJUB_ADDRESS, "0x1fc4DEFBD11b8b72c37f8706ACC2b2Eb63262A80");
  assert.equal(VERIFIERS.registration, "0x1E468EFFA30Cf3C4b6da57c282357bE10E744DFa");
  assert.equal(VERIFIERS.transfer, "0x018a953267FFf33D36702be131f831932ca703a0");
  assert.equal(VERIFIERS.withdraw, "0xFe9F70E9B0f75931618B3Ca73ADD180A4a42Ac0d");
});

test("DeFi periphery addresses match fuji-defi.json", () => {
  assert.equal(USDC_ADDRESS, "0x787bCE271940158A830453Ed9d6F8fB7B916BB76");
  assert.equal(XAV_ADDRESS, "0x6eC47E4601dA3C6246A0cdc7721a39CF224Df390");
  assert.equal(AMM_ADDRESS, "0x1A0236a0Fb5Ef1944F0200D62414A5366b0477E8");
  assert.equal(BRIDGE_ADDRESS, "0x9B30a93976a99df8aD9542eE8931cD78e027f110");
});

test("asset is 2-decimal xUSD and explorer links point at Snowtrace", () => {
  assert.equal(ASSET_DECIMALS, 2);
  assert.equal(ASSET_SYMBOL, "xUSD");
  assert.equal(explorerTx("0xabc"), "https://testnet.snowtrace.io/tx/0xabc");
});

// Every default address must be a valid 0x EVM address (no Stellar G... values).
test("no Stellar-style addresses leak into config defaults", () => {
  const evm = /^0x[0-9a-fA-F]{40}$/;
  for (const a of [
    EERC_ADDRESS,
    REGISTRAR_ADDRESS,
    BABYJUBJUB_ADDRESS,
    USDC_ADDRESS,
    XAV_ADDRESS,
    AMM_ADDRESS,
    BRIDGE_ADDRESS,
    ...Object.values(VERIFIERS),
  ]) {
    assert.match(a, evm);
  }
});
