// Identity provider factory. Default = self-hosted custodial vault. Switch with
// NEXT_PUBLIC_IDENTITY_PROVIDER=selfhosted|web3auth|magic.
import type { IdentityWalletProvider } from "./types";
import { SelfHostedCustodialProvider } from "./self-hosted";
import { Web3AuthProvider } from "./web3auth";
import { MagicProvider } from "./magic";

let _provider: IdentityWalletProvider | null = null;

export function getProvider(): IdentityWalletProvider {
  if (_provider) return _provider;
  const kind = (process.env.NEXT_PUBLIC_IDENTITY_PROVIDER || "selfhosted").toLowerCase();
  // Both "privy" and "selfhosted" use the same same-origin /api/identity/* bridge
  // on the client — key custody (Privy TEE vs local KMS) is chosen server-side.
  _provider =
    kind === "web3auth" ? new Web3AuthProvider() :
    kind === "magic" ? new MagicProvider() :
    new SelfHostedCustodialProvider();
  return _provider;
}
