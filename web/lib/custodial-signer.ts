// Custodial signer: signs Soroban tx XDRs via the identity provider, which
// forwards to the backend (the Stellar secret never reaches the browser). Plugs
// into lib/stellar.ts:setSigner for SSO sessions.
import { getProvider } from "./identity/provider";

export function custodialSigner(): (xdr: string) => Promise<string> {
  return (xdr: string) => getProvider().signTx(xdr);
}
