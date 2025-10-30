import { hexToString } from 'viem'
import { experimental_createEffect, S } from 'envio'
import { getERC20BytesContract, getERC20Contract, executeWithRPCRotation } from './utils'

// Define the schema for token metadata
const tokenMetadataSchema = S.schema({
  name: S.string,
  symbol: S.string,
  decimals: S.number,
})

// Infer the type from the schema
type TokenMetadata = S.Infer<typeof tokenMetadataSchema>

export const getTokenDetails = experimental_createEffect(
  {
    name: "getTokenDetails",
    input: {
      tokenAddress: S.string,
      chainId: S.number,
    },
    output: tokenMetadataSchema,
    cache: true, // Enable caching
  },
  async ({ input, context }) => {
    const { tokenAddress, chainId } = input

    const erc20 = getERC20Contract(tokenAddress as `0x${string}`)
    const erc20Bytes = getERC20BytesContract(tokenAddress as `0x${string}`)

    let decimals = 0;
    let name = "unknown";
    let symbol = "unknown";

    try {
      // Try standard ERC20 calls with RPC rotation
      const results = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.multicall({
            allowFailure: false,
            contracts: [
              {
                ...erc20,
                functionName: "decimals",
              },
              {
                ...erc20,
                functionName: "name",
              },
              {
                ...erc20,
                functionName: "symbol",
              },
            ],
          }) as [number, string, string];
        },
        { enableBatch: true, enableMulticall: true }
      );

      [decimals, name, symbol] = results;
    } catch (error) {
      context.log.info("Standard ERC20 calls failed, trying bytes32 method", {
        tokenAddress,
        chainId,
      })
      
      try {
        // Try bytes32 version with RPC rotation
        const alternateResults = await executeWithRPCRotation(
          chainId,
          async (client) => {
            return await client.multicall({
              allowFailure: false,
              contracts: [
                {
                  ...erc20Bytes,
                  functionName: "decimals",
                },
                {
                  ...erc20Bytes,
                  functionName: "name",
                },
                {
                  ...erc20Bytes,
                  functionName: "symbol",
                },
              ],
            });
          },
          { enableBatch: true, enableMulticall: true }
        );

        decimals = alternateResults[0] as number;
        name = hexToString(alternateResults[1] as `0x${string}`).replace(/\u0000/g, '');
        symbol = hexToString(alternateResults[2] as `0x${string}`).replace(/\u0000/g, '');
      } catch (alternateError) {
        context.log.error(
          `All RPC attempts failed for getTokenDetails on chain ${chainId}. ` +
          `Token: ${tokenAddress}. Error: ${alternateError}`
        );
      }
    }

    context.log.info(`Got token details for ${tokenAddress}: ${name} (${symbol}) with ${decimals} decimals`)

    return {
      name,
      symbol,
      decimals,
    }
  }
)