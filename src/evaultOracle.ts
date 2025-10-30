import { experimental_createEffect, S } from "envio";
import { executeWithRPCRotation, getEulerRouterContract } from "./utils";


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

    const router = getEulerRouterContract(oracle as `0x${string}`)

    let price = 0;
    
    try {
      // Execute RPC call with automatic rotation on failure
      const results = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.multicall({
            allowFailure: false,
            blockNumber: BigInt(blockNumber),
            contracts: [
              {
                ...router,
                functionName: "getQuote",
                args: [inAmount, base, quote],
              }
            ],
          }) as [number];
        },
        { enableBatch: true, enableMulticall: true }
      );
      
      price = results[0];
    } catch (error) {
      console.error(
        `All RPC attempts failed for getQuote on chain ${chainId}, block ${blockNumber}. ` +
        `Returning default value. Error: ${error}`
      );
      price = 0;
    }

    return {
      price,
    }
  }
);
