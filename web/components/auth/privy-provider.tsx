"use client";

// Optional client-side Privy provider for the embedded-wallet UX. Gated on
// NEXT_PUBLIC_PRIVY_APP_ID — when unset it's a no-op so the app runs unchanged.
// The main pay-to-email flow uses Privy SERVER-SIDE (backend/src/privy.mjs); this
// is the in-browser path for users who want to manage their own embedded wallet.
import { PropsWithChildren } from "react";
import { PrivyProvider as BasePrivyProvider } from "@privy-io/react-auth";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function PrivyProvider({ children }: PropsWithChildren) {
  if (!APP_ID) return <>{children}</>;
  return (
    <BasePrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "github"],
        appearance: { theme: "dark", accentColor: "#a855f7" },
      }}
    >
      {children}
    </BasePrivyProvider>
  );
}
