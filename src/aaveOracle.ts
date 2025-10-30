import { experimental_createEffect, S } from "envio";
import { executeWithRPCRotation, getAaveV3OracleContract, getAaveV3OracleAddress } from "./utils";


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

    const oracle = getAaveV3OracleContract(oracleAddress as `0x${string}`)

    let price = 0n;

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
                ...oracle,
                functionName: "getAssetPrice",
                args: [assetAddress],
              }
            ],
          }) as [bigint];
        },
        { enableBatch: true, enableMulticall: true }
      );
      
      price = results[0];
    } catch (error) {
      console.error(
        `All RPC attempts failed for getAssetPrice on chain ${chainId}. ` +
        `Returning default value. Error: ${error}`
      );
      price = 0n;
    }

    return {
      price,
    }
  }
);
