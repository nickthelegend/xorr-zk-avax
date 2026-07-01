// Multi-wallet Stellar signing via Stellar Wallets Kit (Freighter, xBull, Albedo,
// Rabet, Lobstr, Hana, Ledger, WalletConnect, …). The kit is browser-only and
// touches the DOM, so it's dynamically imported on first use to keep SSR clean.
import { NETWORK, NETWORK_PASSPHRASE } from "./config";

type Kit = {
  authModal: () => Promise<{ address: string }>;
  getAddress: () => Promise<{ address: string }>;
  getNetwork: () => Promise<{ network: string; networkPassphrase: string }>;
  signTransaction: (
    xdr: string,
    opts: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string }>;
  disconnect: () => Promise<void>;
  setNetwork: (n: string) => void;
};

let _kit: Promise<Kit> | null = null;

async function kit(): Promise<Kit> {
  if (typeof window === "undefined") throw new Error("wallet kit is browser-only");
  if (!_kit) {
    _kit = (async () => {
      const [{ StellarWalletsKit }, { Networks, SwkAppDarkTheme }, fr, xb, al, ra, lo, ha] =
        await Promise.all([
          import("@creit-tech/stellar-wallets-kit/sdk"),
          import("@creit-tech/stellar-wallets-kit/types"),
          import("@creit-tech/stellar-wallets-kit/modules/freighter"),
          import("@creit-tech/stellar-wallets-kit/modules/xbull"),
          import("@creit-tech/stellar-wallets-kit/modules/albedo"),
          import("@creit-tech/stellar-wallets-kit/modules/rabet"),
          import("@creit-tech/stellar-wallets-kit/modules/lobstr"),
          import("@creit-tech/stellar-wallets-kit/modules/hana"),
        ]);
      // The major Stellar wallets (the kit times out each availability check at 1s).
      const modules = [
        new fr.FreighterModule(),
        new xb.xBullModule(),
        new al.AlbedoModule(),
        new ra.RabetModule(),
        new lo.LobstrModule(),
        new ha.HanaModule(),
      ];
      StellarWalletsKit.init({
        modules,
        network: NETWORK === "public" ? Networks.PUBLIC : Networks.TESTNET,
        // Dark + purple theme to match XORR (Ghost).
        theme: {
          ...SwkAppDarkTheme,
          background: "#161616",
          "background-secondary": "#101010",
          "foreground-strong": "#ffffff",
          foreground: "#f4f4f5",
          "foreground-secondary": "#a1a1aa",
          primary: "#e2a9f1",
          "primary-foreground": "#101010",
          border: "rgba(255,255,255,0.10)",
          "border-radius": "0.85rem",
          shadow: "0 24px 48px -24px rgba(0,0,0,0.75)",
        },
      });
      return StellarWalletsKit as unknown as Kit;
    })();
  }
  return _kit;
}

/** Open the wallet selector modal; returns the chosen account's public key. */
export async function connect(): Promise<string> {
  const k = await kit();
  const { address } = await k.authModal();
  return address;
}

/** The connected account, or null if no wallet is selected yet. */
export async function currentAddress(): Promise<string | null> {
  try {
    const k = await kit();
    const { address } = await k.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

export async function currentNetwork(): Promise<string> {
  try {
    const k = await kit();
    const { network } = await k.getNetwork();
    return network ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

/** Sign a transaction XDR with the connected wallet; returns the signed XDR. */
export async function sign(xdr: string): Promise<string> {
  const k = await kit();
  const { address } = await k.getAddress();
  const { signedTxXdr } = await k.signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
    address,
  });
  return signedTxXdr;
}

export async function disconnect(): Promise<void> {
  try {
    const k = await kit();
    await k.disconnect();
  } catch {
    /* ignore */
  }
}
