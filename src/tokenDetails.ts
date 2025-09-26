import { createPublicClient, http, hexToString } from 'viem'
import { mainnet, optimism, arbitrum, polygon, base, gnosis, linea, scroll, avalanche, bsc } from 'viem/chains'
import { experimental_createEffect, S } from 'envio'
import { getERC20BytesContract, getERC20Contract } from './utils'

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
    const rpcUrls: Record<number, string> = {
        1: process.env.RPC_URL_1 || "https://eth.drpc.org",
        10: process.env.RPC_URL_10 || "https://optimism.drpc.org",
        42161: process.env.RPC_URL_42161 || "https://arbitrum.drpc.org",
        137: process.env.RPC_URL_137 || "https://polygon.drpc.org",
        8453: process.env.RPC_URL_8453 || "https://base.drpc.org",
        100: process.env.RPC_URL_100 || "https://gnosis.drpc.org",
        59144: process.env.RPC_URL_59144 || "https://linea.drpc.org",
        534352: process.env.RPC_URL_534352 || "https://scroll.drpc.org",
        43114: process.env.RPC_URL_43114 || "https://avalanche.drpc.org",
        56: process.env.RPC_URL_56 || "https://bsc.drpc.org",
    };
    
    const RPC_URL = rpcUrls[chainId] || process.env.RPC_URL || "https://eth.drpc.org";

    const chainMap: Record<number, any> = {
        1: mainnet,
        10: optimism,
        42161: arbitrum,
        137: polygon,
        8453: base,
        100: gnosis,
        59144: linea,
        534352: scroll,
        43114: avalanche,
        56: bsc,
    };
    
    const client = createPublicClient({
      chain: chainMap[chainId] || mainnet,
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