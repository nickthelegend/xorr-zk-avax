"use client";

import { PropsWithChildren } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { EvmProviders } from "@/lib/evm";
import { StellarWalletProvider } from "@/components/stellar-wallet-provider";

// XORR on Avalanche provider stack:
//   ThemeProvider → wagmi/RainbowKit (Fuji) → eERC wallet context → Toaster.
// (The Stellar + Privy providers from the original app are retired; the wallet
// context is now backed by Avalanche's eERC.)
export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <EvmProviders>
        <StellarWalletProvider>
          {children}
          <Toaster position="top-right" theme="dark" richColors closeButton />
        </StellarWalletProvider>
      </EvmProviders>
    </ThemeProvider>
  );
}
