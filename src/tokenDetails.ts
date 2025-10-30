import { createPublicClient, http, hexToString } from 'viem'
import { experimental_createEffect, S } from 'envio'
import { getERC20BytesContract, getERC20Contract, getChain, getRPCUrl } from './utils'

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
    const chain = getChain(chainId)
    const RPC_URL = getRPCUrl(chainId)
    const client = createPublicClient({
      chain: chain,
      batch: { multicall: true },
      transport: http(RPC_URL, { batch: true })
    })

    const erc20 = getERC20Contract(tokenAddress as `0x${string}`)
    const erc20Bytes = getERC20BytesContract(tokenAddress as `0x${string}`)

    let results: [number, string, string]
    try {
      results = await client.multicall({
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
      }) as [number, string, string]
    } catch (error) {
      context.log.info("First multicall failed, trying alternate method", {
        tokenAddress,
        chainId,
      })
      try {
        const alternateResults = await client.multicall({
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
        })
        results = [
          alternateResults[0] as number,
          hexToString(alternateResults[1] as `0x${string}`).replace(/\u0000/g, ''),
          hexToString(alternateResults[2] as `0x${string}`).replace(/\u0000/g, ''),
        ]
      } catch (alternateError) {
        context.log.error("Alternate method failed", {
          tokenAddress,
          chainId,
          err: alternateError,
        })
        results = [0, "unknown", "unknown"]
      }
    }

    const [decimals, name, symbol] = results

    context.log.info(`Got token details for ${tokenAddress}: ${name} (${symbol}) with ${decimals} decimals`)

    return {
      name,
      symbol,
      decimals,
    }
  }
)