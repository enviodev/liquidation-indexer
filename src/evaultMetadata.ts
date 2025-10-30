import { createPublicClient, http } from "viem";
import { experimental_createEffect, S } from "envio";
import { getChain, getRPCUrl, getEVaultContract } from "./utils";


// Define the schema for the effect output
const EVaultMetadataSchema = S.schema({
  asset: S.string,
  name: S.string,
  symbol: S.string,
  oracle: S.string,
  unitOfAccount: S.string,
  decimals: S.number,
})

// Infer the type from the schema
type EVaultMetadata = S.Infer<typeof EVaultMetadataSchema>;

export const getEVaultMetadata = experimental_createEffect(
  {
    name: "getEVaultMetadata",
    input: {
      vaultAddress: S.string,
      chainId: S.number,
    },
    output: EVaultMetadataSchema,
    // Enable caching to avoid duplicated calls
    cache: false,
  },
  async ({ input }) => {
    const { vaultAddress, chainId } = input

    // Map chain IDs to RPC URLs for all configured chains
    const chain = getChain(chainId)
    const RPC_URL = getRPCUrl(chainId)

    // Create a public client for the specific chain
    const client = createPublicClient({
      chain: chain,
      batch: { multicall: true },
      transport: http(RPC_URL, { batch: true }),
    })

    const evault = getEVaultContract(vaultAddress as `0x${string}`)

    let results: [string, string, string, string, string, number]
    try {
      results = await client.multicall({
        allowFailure: false,
        contracts: [
          {
            ...evault,
            functionName: "asset",
            args: [],
          },
          {
            ...evault,
            functionName: "name",
            args: [],
          },
          {
            ...evault,
            functionName: "symbol",
            args: [],
          },
          {
            ...evault,
            functionName: "oracle",
            args: [],
          },
          {
            ...evault,
            functionName: "unitOfAccount",
            args: [],
          },
          {
            ...evault,
            functionName: "decimals",
            args: [],
          },
        ],
      }) as [string, string, string, string, string, number]
    } catch (error) {
      results = [
        "unknown",
        "unknown",  
        "unknown",
        "unknown",
        "unknown",
        0,  
      ]
      console.error("First multicall failed, trying alternate method", error)
    }

    const [asset, name, symbol, oracle, unitOfAccount, decimals] = results

    return {
      asset,
      name,
      symbol,
      oracle,
      unitOfAccount,
      decimals,
    }
  }
);
