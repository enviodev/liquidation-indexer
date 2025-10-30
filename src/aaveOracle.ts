import { createPublicClient, http } from "viem";
import { experimental_createEffect, S } from "envio";
import { getChain, getRPCUrl, getAaveV3OracleContract, getAaveV3OracleAddress } from "./utils";


// Define the schema for the effect output
const getAssetPriceSchema = S.schema({
  price: S.bigint,
})

// Infer the type from the schema
type getAssetPrice = S.Infer<typeof getAssetPriceSchema>;

export const getAssetPrice = experimental_createEffect(
  {
    name: "getAssetPrice",
    input: {
      assetAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: getAssetPriceSchema,
    // Enable caching to avoid duplicated calls
    cache: true,
  },
  async ({ input }) => {
    const { assetAddress, chainId, blockNumber } = input
    const oracleAddress = getAaveV3OracleAddress(chainId)

    // Map chain IDs to RPC URLs for all configured chains
    const chain = getChain(chainId)
    const RPC_URL = getRPCUrl(chainId)

    // Create a public client for the specific chain
    const client = createPublicClient({
      chain: chain,
      batch: { multicall: true },
      transport: http(RPC_URL, { batch: true }),
    })

    const oracle = getAaveV3OracleContract(oracleAddress as `0x${string}`)

    let results: [bigint]
    try {
      results = await client.multicall({
        allowFailure: false,
        blockNumber: BigInt(blockNumber),
        contracts: [
          {
            ...oracle,
            functionName: "getAssetPrice",
            args: [assetAddress],
          }
        ],
      }) as [bigint]
    } catch (error) {
      results = [0n]
      console.error("First multicall failed, trying alternate method", error)
    }

    const price = results[0]

    return {
      price,
    }
  }
);
