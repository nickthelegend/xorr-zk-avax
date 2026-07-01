"use client";

// XORR on Avalanche uses a single wallet-based identity (eERC keys are derived
// from the wallet signature), so the social sign-in (Privy) from the Stellar
// build is retired. This is a no-op placeholder that keeps the header import
// stable without pulling in the auth SDK.
export function SignInButton() {
  return null;
}
