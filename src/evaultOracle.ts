import { createPublicClient, http } from "viem";
import { experimental_createEffect, S } from "envio";
import { getChain, getRPCUrl, getEulerRouterContract } from "./utils";


// Define the schema for the effect output
const getQuoteSchema = S.schema({
  price: S.number,
})

// Infer the type from the schema
type getQuote = S.Infer<typeof getQuoteSchema>;

export const getQuote = experimental_createEffect(
  {
    name: "getQuote",
    input: {
      oracle: S.string,
      inAmount: S.bigint,
      base: S.string,
      quote: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: getQuoteSchema,
    // Enable caching to avoid duplicated calls
    cache: false,
  },
  async ({ input }) => {
    const { oracle, inAmount, base, quote, chainId, blockNumber } = input

    // Map chain IDs to RPC URLs for all configured chains
    const chain = getChain(chainId)
    const RPC_URL = getRPCUrl(chainId)

    // Create a public client for the specific chain
    const client = createPublicClient({
      chain: chain,
      batch: { multicall: true },
      transport: http(RPC_URL, { batch: true }),
    })

    const router = getEulerRouterContract(oracle as `0x${string}`)

    let results: [number]
    try {
      results = await client.multicall({
        allowFailure: false,
        blockNumber: BigInt(blockNumber),
        contracts: [
          {
            ...router,
            functionName: "getQuote",
            args: [inAmount, base, quote],
          }
        ],
      }) as [number]
    } catch (error) {
      results = [0]
      console.error("First multicall failed, trying alternate method", error)
    }

    const [price] = results

    return {
      price,
    }
  }
);
