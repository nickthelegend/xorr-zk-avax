// Soroban contract invocation: build -> simulate -> assemble -> sign -> send.
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  rpc as SorobanRpc,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE, SIM_SOURCE } from "./config";
import { sign as freighterSign } from "./wallet";

export const server = new SorobanRpc.Server(RPC_URL, {
  allowHttp: RPC_URL.startsWith("http://"),
});

// Pluggable transaction signer. Defaults to Freighter; an SSO/custodial session
// swaps in a server-side signer (lib/custodial-signer.ts) via setSigner so the
// same `invoke` path works for both wallet types.
type Signer = (xdr: string) => Promise<string>;
let _signer: Signer = freighterSign;
export function setSigner(fn: Signer) { _signer = fn; }
export function resetSigner() { _signer = freighterSign; }
/** Sign an arbitrary transaction XDR with the active wallet (Freighter/custodial).
 *  Used by the SEP-24 anchor flow (SEP-10 challenge + classic withdrawal payment). */
export function signXdr(xdr: string): Promise<string> { return _signer(xdr); }

// Tx listener — fired after every successful state-changing invoke with the tx
// hash, so the UI can surface a toast linking to the explorer. One global
// listener (set by the wallet provider) is enough.
type TxListener = (hash: string, method: string) => void;
let _onTx: TxListener | null = null;
export function setTxListener(fn: TxListener | null) { _onTx = fn; }
/** Fire the tx toast for a transaction submitted outside `invoke` (e.g. the
 *  SEP-24 off-ramp's classic payment via Horizon). */
export function notifyTx(hash: string, method: string) { try { _onTx?.(hash, method); } catch { /* ignore */ } }

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read-only contract call via simulation (no signature, no fee). */
export async function simulateCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<any> {
  const account = await server.getAccount(
    // any funded account works for simulation; use a throwaway if needed
    await anyAccountId(),
  );
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result?.retval) return null;
  return scValToNative(sim.result.retval);
}

/** State-changing invocation signed by `publicKey` via Freighter. */
export async function invoke(
  publicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<{ hash: string; returnValue: any }> {
  const account = await server.getAccount(publicKey);
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(built);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);

  const prepared = SorobanRpc.assembleTransaction(built, sim).build();
  const signedXdr = await _signer(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  const sent = await server.sendTransaction(signed as any);
  if (sent.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);

  // Surface the clickable tx toast the moment the tx is submitted (the hash is
  // already known) — so the user always gets a stellar.expert link even when
  // on-chain confirmation is slow on testnet.
  try { _onTx?.(sent.hash, method); } catch { /* listener errors must not fail the tx */ }

  let got = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && got.status === "NOT_FOUND"; i++) {
    await delay(1000);
    got = await server.getTransaction(sent.hash);
  }
  if (got.status !== "SUCCESS") throw new Error(`tx ${sent.hash} status=${got.status}`);

  return {
    hash: sent.hash,
    returnValue: got.returnValue ? scValToNative(got.returnValue) : null,
  };
}

// ---- ScVal builders ----------------------------------------------------

export const addr = (a: string): xdr.ScVal => new Address(a).toScVal();
export const i128 = (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "i128" });
export const u32 = (v: number): xdr.ScVal => nativeToScVal(v, { type: "u32" });
export const bool = (b: boolean): xdr.ScVal => xdr.ScVal.scvBool(b);
export const u64 = (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "u64" });
export const u256 = (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "u256" });

/** Field-element public-signal vector (Vec<u256>) for verify_proof. */
export const vecU256 = (vals: bigint[]): xdr.ScVal => xdr.ScVal.scvVec(vals.map(u256));

/** 32-byte value (commitment/nullifier/root) -> ScVal BytesN<32>. */
export function bytesN32(bytes: Uint8Array): xdr.ScVal {
  if (bytes.length !== 32) throw new Error("expected 32 bytes");
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

// Source account for simulations. Defaults to a funded read-only account so the
// UI can load on-chain data (reserves, quotes, chain state) before a wallet
// connects; replaced by the connected wallet's address on connect/sign-in.
let _simAccount: string = SIM_SOURCE;
export function setSimAccount(id: string) {
  _simAccount = id;
}
async function anyAccountId(): Promise<string> {
  return _simAccount;
}
