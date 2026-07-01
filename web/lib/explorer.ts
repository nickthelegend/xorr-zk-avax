// stellar.expert explorer links, network-aware (testnet vs public).
import { NETWORK } from "./config";

export function explorerNetwork(): "public" | "testnet" {
  const n = (NETWORK || "testnet").toLowerCase();
  return n === "public" || n === "mainnet" || n === "pubnet" ? "public" : "testnet";
}

export function explorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/${explorerNetwork()}/tx/${hash}`;
}

export function explorerAccountUrl(address: string): string {
  return `https://stellar.expert/explorer/${explorerNetwork()}/account/${address}`;
}
