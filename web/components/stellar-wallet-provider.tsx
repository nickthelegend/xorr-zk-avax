"use client";

// XORR on Avalanche — wallet + eERC state for the whole app.
//
// This module keeps the original `useWallet()` contract (so the header, home
// hub, and every action page keep working) but the engine underneath is now
// Avalanche's eERC (Encrypted ERC) via wagmi + @avalabs/ac-eerc-sdk instead of
// Stellar/Soroban. Balances and amounts are encrypted on-chain; all crypto runs
// client-side and the contract only verifies zk-SNARK proofs.
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { toast } from "sonner";
// @ts-expect-error — SDK ships loose types; runtime shape matches the eERC docs.
import { useEERC } from "@avalabs/ac-eerc-sdk";
import {
  EERC_ADDRESS,
  circuitURLs,
  proverURLs,
  isConfigured,
  explorerTx,
} from "@/lib/config";
import { short } from "@/lib/format";
import { burst } from "@/lib/confetti";

export type SignInMode = "wallet" | null;

export interface ChainState {
  total: bigint;
  root: string;
}

export interface WalletContextValue {
  // ── original contract (kept so existing consumers compile) ────────────────
  address: string | null;
  wallet: unknown | null;
  setWallet: (w: unknown | null) => void;
  ready: boolean;
  busy: boolean;
  busyMsg: string;
  log: string[];
  pushLog: (m: string) => void;
  proofReady: boolean;
  chain: ChainState | null;
  balance: bigint;
  refreshChain: () => Promise<void>;
  refresh: () => void;
  connect: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  resetWallet: () => void;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  signInMode: SignInMode;
  identity: null;
  claimAccount: () => Promise<void>;

  // ── eERC additions ────────────────────────────────────────────────────────
  configured: boolean;
  isInitialized: boolean;
  isRegistered: boolean;
  keyLoaded: boolean;
  shouldGenerateKey: boolean;
  isConverter: boolean;
  isAuditorKeySet: boolean;
  areYouAuditor: boolean;
  owner?: string;
  auditorAddress?: string;
  decimals: bigint;
  parsedBalance: string;
  register: () => Promise<void>;
  generateKey: () => Promise<void>;
  isAddressRegistered: (a: `0x${string}`) => Promise<{ isRegistered: boolean }>;
  privateMint: (to: `0x${string}`, amt: bigint) => Promise<{ transactionHash: string }>;
  privateBurn: (amt: bigint) => Promise<{ transactionHash: string }>;
  privateTransfer: (to: `0x${string}`, amt: bigint) => Promise<{ transactionHash: string }>;
  setAuditor: (a: `0x${string}`) => Promise<string>;
  auditorDecrypt: () => Promise<
    { type: string; amount: string; sender: string; receiver: string | null; transactionHash: string }[]
  >;
  refetchBalance: () => void;
}

const Ctx = createContext<WalletContextValue | null>(null);
const LOG_KEY = "xorr.activity.v1";

export function useWallet(): WalletContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used inside <StellarWalletProvider>");
  return c;
}

// The decryption key is deterministic from the wallet signature; we cache it per
// address so a returning user doesn't have to re-sign every reload.
const keyStore = {
  get(addr?: string | null) {
    if (!addr || typeof window === "undefined") return undefined;
    return localStorage.getItem(`xorr:dk:${addr.toLowerCase()}`) ?? undefined;
  },
  set(addr: string, key: string) {
    if (typeof window !== "undefined")
      localStorage.setItem(`xorr:dk:${addr.toLowerCase()}`, key);
  },
};

// The eERC SDK (useEERC) resolves relative circuit URLs against `location.origin`
// at hook-init, which throws during SSR/prerender. So the engine — which calls
// useEERC + all wagmi hooks — only renders on the client; during SSR we hand
// down a safe default context.
const DEFAULT_CTX: WalletContextValue = {
  address: null,
  wallet: null,
  setWallet: () => {},
  ready: false,
  busy: false,
  busyMsg: "",
  log: [],
  pushLog: () => {},
  proofReady: false,
  chain: null,
  balance: 0n,
  refreshChain: async () => {},
  refresh: () => {},
  connect: async () => {},
  disconnectWallet: async () => {},
  resetWallet: () => {},
  run: async () => {},
  signInMode: null,
  identity: null,
  claimAccount: async () => {},
  configured: isConfigured(),
  isInitialized: false,
  isRegistered: false,
  keyLoaded: false,
  shouldGenerateKey: false,
  isConverter: false,
  isAuditorKeySet: false,
  areYouAuditor: false,
  owner: undefined,
  auditorAddress: undefined,
  decimals: 2n,
  parsedBalance: "0",
  register: async () => {},
  generateKey: async () => {},
  isAddressRegistered: async () => ({ isRegistered: false }),
  privateMint: async () => ({ transactionHash: "" }),
  privateBurn: async () => ({ transactionHash: "" }),
  privateTransfer: async () => ({ transactionHash: "" }),
  setAuditor: async () => "0x",
  auditorDecrypt: async () => [],
  refetchBalance: () => {},
};

// The eERC SDK's in-browser balance decryption (BabyJubJub/ElGamal + Poseidon)
// can throw transiently on certain ciphertext states ("The last element of the
// message must be 0"). That's an engine-only concern — pages like the faucet
// (a plain ERC-20 mint) don't need eERC at all — so we isolate the engine behind
// an error boundary: on a decryption fault we fall back to the safe default
// context (keeping the rest of the app usable) and auto-retry the engine shortly
// after, rather than crashing the whole tree.
class EngineErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // give the SDK a beat, then remount the engine and try again
    setTimeout(() => {
      this.setState({ failed: false });
      this.props.onRetry();
    }, 1500);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function StellarWalletProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [engineKey, setEngineKey] = useState(0);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <Ctx.Provider value={DEFAULT_CTX}>{children}</Ctx.Provider>;
  }
  return (
    <EngineErrorBoundary
      fallback={<Ctx.Provider value={DEFAULT_CTX}>{children}</Ctx.Provider>}
      onRetry={() => setEngineKey((k) => k + 1)}
    >
      <EngineProvider key={engineKey}>{children}</EngineProvider>
    </EngineErrorBoundary>
  );
}

function EngineProvider({ children }: { children: ReactNode }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address: acct, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [decryptionKey, setDecryptionKey] = useState<string | undefined>();
  const logLoaded = useRef(false);

  const address = (acct as string) ?? null;

  const pushLog = useCallback((m: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 60));
  }, []);

  // Load / persist activity feed.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOG_KEY);
      if (saved) setLog(JSON.parse(saved));
    } catch {
      /* ignore */
    }
    logLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!logLoaded.current) return;
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch {
      /* ignore */
    }
  }, [log]);

  // Restore any cached decryption key when the account changes.
  useEffect(() => {
    setDecryptionKey(keyStore.get(address));
  }, [address]);

  // eERC engine.
  const eerc = useEERC(
    publicClient,
    walletClient,
    EERC_ADDRESS,
    proverURLs,
    circuitURLs,
    decryptionKey
  );
  // The eERC encrypted-balance hook decrypts on-chain ciphertext in-render and can
  // throw on certain states (see EncryptedBalanceProbe). We call it inside an
  // isolated child boundary and lift its result here, so a decryption fault never
  // tears down the engine — connect, the plain-USDC faucet, and navigation keep
  // working even when the shielded balance can't be read.
  const [bal, setBal] = useState<any>(undefined);
  const [balAttempt, setBalAttempt] = useState(0);
  const onBalFail = useCallback(() => {
    setBal(undefined);
    setBalAttempt((n) => (n < 3 ? n + 1 : n)); // bounded retry, then give up quietly
  }, []);

  const isInitialized = Boolean(eerc?.isInitialized);
  const isRegistered = Boolean(eerc?.isRegistered);
  const keyLoaded = Boolean(decryptionKey);
  const balance = (bal?.decryptedBalance as bigint) ?? 0n;

  // Surface a clickable toast for confirmed txs.
  const notifyTx = useCallback(
    (hash: string, method: string) => {
      pushLog(`✓ ${method} · ${hash.slice(0, 8)}…`);
      burst();
      toast.success("Transaction submitted", {
        description: `${method} · ${hash.slice(0, 10)}…${hash.slice(-6)}`,
        action: {
          label: "Snowtrace ↗",
          onClick: () => window.open(explorerTx(hash), "_blank", "noopener,noreferrer"),
        },
        duration: 10000,
      });
    },
    [pushLog]
  );

  const connect = useCallback(async () => {
    try {
      const injected = connectors[0];
      if (!injected) throw new Error("No injected wallet found (install Core or MetaMask)");
      const res = await connectAsync({ connector: injected });
      const a = res.accounts?.[0];
      if (a) pushLog(`Connected ${short(a)}`);
    } catch (e) {
      pushLog(`⚠ ${(e as Error).message}`);
    }
  }, [connectAsync, connectors, pushLog]);

  const disconnectWallet = useCallback(async () => {
    await disconnectAsync();
    pushLog("Wallet disconnected");
  }, [disconnectAsync, pushLog]);

  const register = useCallback(async () => {
    const res = await eerc?.register?.();
    const key = res?.key;
    if (key && address) {
      keyStore.set(address, key);
      setDecryptionKey(key);
    }
    if (res?.transactionHash) notifyTx(res.transactionHash, "Register");
    pushLog("Registered with eERC");
  }, [eerc, address, notifyTx, pushLog]);

  const generateKey = useCallback(async () => {
    const key = await eerc?.generateDecryptionKey?.();
    if (key && address) {
      keyStore.set(address, key);
      setDecryptionKey(key);
    }
    pushLog("Decryption key loaded");
  }, [eerc, address, pushLog]);

  const refetchBalance = useCallback(() => bal?.refetchBalance?.(), [bal]);

  const refreshChain = useCallback(async () => {
    refetchBalance();
  }, [refetchBalance]);

  const refresh = useCallback(() => {
    refetchBalance();
  }, [refetchBalance]);

  // Busy-wrapped action runner (kept API-compatible with the old provider).
  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (!address) {
        pushLog("⚠ Connect a wallet first");
        return;
      }
      setBusy(true);
      setBusyMsg(label);
      try {
        await fn();
        refetchBalance();
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        pushLog(`⚠ ${msg}`);
        toast.error(msg.length > 120 ? `${msg.slice(0, 120)}…` : msg);
      } finally {
        setBusy(false);
        setBusyMsg("");
      }
    },
    [address, pushLog, refetchBalance]
  );

  const value = useMemo<WalletContextValue>(() => {
    const wrapTx =
      (fn?: (...a: any[]) => Promise<any>, label = "Transaction") =>
      async (...a: any[]) => {
        const res = await fn?.(...a);
        if (res?.transactionHash) notifyTx(res.transactionHash, label);
        return res;
      };

    return {
      address,
      wallet: address && isRegistered ? { ready: true } : null,
      setWallet: () => {},
      ready: Boolean(publicClient),
      busy,
      busyMsg,
      log,
      pushLog,
      proofReady: isInitialized,
      chain: isConfigured() ? { total: balance, root: "" } : null,
      balance,
      refreshChain,
      refresh,
      connect,
      disconnectWallet,
      resetWallet: () => pushLog("Reset not applicable for eERC (balance is on-chain)"),
      run,
      signInMode: isConnected ? "wallet" : null,
      identity: null,
      claimAccount: async () => {},

      configured: isConfigured(),
      isInitialized,
      isRegistered,
      keyLoaded,
      shouldGenerateKey: Boolean(eerc?.shouldGenerateDecryptionKey),
      isConverter: Boolean(eerc?.isConverter),
      isAuditorKeySet: Boolean(eerc?.isAuditorKeySet),
      areYouAuditor: Boolean(eerc?.areYouAuditor),
      owner: eerc?.owner,
      auditorAddress: eerc?.auditorAddress,
      decimals: (bal?.decimals as bigint) ?? 2n,
      parsedBalance: bal?.parsedDecryptedBalance ?? "0",
      register,
      generateKey,
      isAddressRegistered: (a) =>
        eerc?.isAddressRegistered?.(a) ?? Promise.resolve({ isRegistered: false }),
      privateMint: wrapTx(bal?.privateMint, "Private mint") as WalletContextValue["privateMint"],
      privateBurn: wrapTx(bal?.privateBurn, "Private burn") as WalletContextValue["privateBurn"],
      privateTransfer: wrapTx(bal?.privateTransfer, "Private transfer") as WalletContextValue["privateTransfer"],
      setAuditor: (a) => eerc?.setContractAuditorPublicKey?.(a),
      auditorDecrypt: () => eerc?.auditorDecrypt?.() ?? Promise.resolve([]),
      refetchBalance,
    };
  }, [
    address,
    isRegistered,
    publicClient,
    busy,
    busyMsg,
    log,
    pushLog,
    isInitialized,
    balance,
    refreshChain,
    refresh,
    connect,
    disconnectWallet,
    run,
    isConnected,
    eerc,
    bal,
    keyLoaded,
    register,
    generateKey,
    refetchBalance,
    notifyTx,
  ]);

  return (
    <Ctx.Provider value={value}>
      {eerc ? (
        <BalanceBoundary key={balAttempt} onFail={onBalFail}>
          <EncryptedBalanceProbe eerc={eerc} onBal={setBal} />
        </BalanceBoundary>
      ) : null}
      {children}
    </Ctx.Provider>
  );
}

// Calls the eERC balance hook in isolation and lifts the result to the engine.
// The hook throws synchronously in-render on certain ciphertext states (the SDK's
// ElGamal/Poseidon decrypt asserts message padding). Rendering it here — behind
// BalanceBoundary — means that throw is contained to the balance readout instead
// of collapsing the whole wallet engine.
function EncryptedBalanceProbe({ eerc, onBal }: { eerc: any; onBal: (b: unknown) => void }) {
  const bal = eerc?.useEncryptedBalance?.();
  useEffect(() => {
    onBal(bal);
  }, [bal, onBal]);
  return null;
}

class BalanceBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
