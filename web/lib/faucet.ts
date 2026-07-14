// Testnet faucet client — Avalanche Fuji (C-Chain).
//
// Mints the underlying public ERC-20 (the eERC deposit / bridge token, "USDC"
// in fuji-defi.json) straight to the connected EVM wallet via viem. The token
// exposes a permissionless `mint(address,uint256)` for testnet, so any funded
// wallet can top itself up to try the Swap and Bridge flows. Gas (Fuji AVAX)
// comes from the external Core faucet (FUJI.faucet).
//
// No Stellar: this replaces the old friendbot / trustline / Freighter faucet.
import type { PublicClient, WalletClient } from "viem";
import { USDC_ADDRESS, XAV_ADDRESS, ASSET_DECIMALS } from "./config";

const MINTABLE_ERC20_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const SCALE = 10n ** BigInt(ASSET_DECIMALS);

/** Amount → base units (respects the token's 2-decimal precision). */
export function toBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * Number(SCALE)));
}

/**
 * Mint `amount` of a test ERC-20 to `to` on Fuji and wait for the receipt.
 * Returns the transaction hash. Defaults to the underlying USDC token.
 */
export async function mintTestToken(
  walletClient: WalletClient,
  publicClient: PublicClient,
  to: `0x${string}`,
  amount = 1000,
  token: `0x${string}` = USDC_ADDRESS,
): Promise<`0x${string}`> {
  const account = walletClient.account;
  if (!account) throw new Error("Connect a Fuji wallet first");
  const hash = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: token,
    abi: MINTABLE_ERC20_ABI,
    functionName: "mint",
    args: [to, toBaseUnits(amount)],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Mint test USDC (the eERC deposit token) to the connected wallet. */
export const mintTestUsdc = (
  walletClient: WalletClient,
  publicClient: PublicClient,
  to: `0x${string}`,
  amount = 1000,
) => mintTestToken(walletClient, publicClient, to, amount, USDC_ADDRESS);

/** Mint test XAV (the AMM pair token) to the connected wallet. */
export const mintTestXav = (
  walletClient: WalletClient,
  publicClient: PublicClient,
  to: `0x${string}`,
  amount = 1000,
) => mintTestToken(walletClient, publicClient, to, amount, XAV_ADDRESS);
