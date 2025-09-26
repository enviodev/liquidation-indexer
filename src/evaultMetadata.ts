import { createPublicClient, http } from "viem";
import { experimental_createEffect, S } from "envio";
import * as fs from "fs";
import * as path from "path";

// Load the EVault ABI
const EVaultAbi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../abis/EVault.json"), "utf8")
);

// Define the schema for the effect output
const vaultAssetSchema = S.string;

// Infer the type from the schema
type VaultAsset = S.Infer<typeof vaultAssetSchema>;

export const getVaultAsset = experimental_createEffect(
  {
    name: "getVaultAsset",
    input: {
      vaultAddress: S.string,
      chainId: S.number,
    },
    output: vaultAssetSchema,
    // Enable caching to avoid duplicated calls
    cache: true,
  },
  async ({ input }: { input: { vaultAddress: string; chainId: number } }) => {
    const { vaultAddress, chainId } = input;

    // Map chain IDs to RPC URLs for all configured chains
    const rpcUrls: Record<number, string> = {
      1: process.env.RPC_URL_1 || "https://eth-mainnet.public.blastapi.io",
      10: process.env.RPC_URL_10 || "https://mainnet.optimism.io",
      42161: process.env.RPC_URL_42161 || "https://arb1.arbitrum.io/rpc",
      137: process.env.RPC_URL_137 || "https://polygon-rpc.com",
      8453: process.env.RPC_URL_8453 || "https://mainnet.base.org",
      100: process.env.RPC_URL_100 || "https://rpc.gnosischain.com",
      59144: process.env.RPC_URL_59144 || "https://rpc.linea.build",
      534352: process.env.RPC_URL_534352 || "https://rpc.scroll.io",
      43114: process.env.RPC_URL_43114 || "https://api.avax.network/ext/bc/C/rpc",
      56: process.env.RPC_URL_56 || "https://bsc-dataseed1.binance.org",
    };

    const RPC_URL = rpcUrls[chainId] || process.env.RPC_URL || "http://localhost:8545";

    // Create a public client for the specific chain
    const client = createPublicClient({
      transport: http(RPC_URL),
    });

    try {
      // Call the asset() function to get the underlying asset
      const asset = await client.readContract({
        address: vaultAddress as `0x${string}`,
        abi: EVaultAbi,
        functionName: "asset",
        args: [],
      });

      return asset as string;
    } catch (error) {
      console.error(`Failed to get asset for vault ${vaultAddress}:`, error);
      throw new Error(`Failed to fetch asset for vault ${vaultAddress}: ${error}`);
    }
  }
);
