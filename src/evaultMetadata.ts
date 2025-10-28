import { experimental_createEffect, S } from "envio";
import { executeWithRPCRotation, getEVaultContract } from "./utils";


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
      blockNumber: S.bigint,
    },
    output: EVaultMetadataSchema,
    // Enable caching to avoid duplicated calls
    cache: false,
  },
  async ({ input }) => {
    const { vaultAddress, chainId, blockNumber } = input

    const evault = getEVaultContract(vaultAddress as `0x${string}`)

    let asset = "unknown";
    let name = "unknown";
    let symbol = "unknown";
    let oracle = "unknown";
    let unitOfAccount = "unknown";
    let decimals = 0;

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
          }) as [string, string, string, string, string, number];
        },
        { enableBatch: true, enableMulticall: true }
      );
      
      [asset, name, symbol, oracle, unitOfAccount, decimals] = results;
      if (oracle === "0x0000000000000000000000000000000000000000") {
        const oracleResult = await executeWithRPCRotation(
          chainId,
          async (client) => {
            return await client.multicall({
              allowFailure: false,
              contracts: [
                {
                  ...evault,
                  functionName: "oracle",
                  args: [],
                },
              ],
            }) as [string];
          },
          { enableBatch: true, enableMulticall: true }
        );
        oracle = oracleResult[0];
      }
    } catch (error) {
      console.error(
        `All RPC attempts failed for getEVaultMetadata on chain ${chainId}. ` +
        `Returning default values. Error: ${error}`
      );
    }

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
