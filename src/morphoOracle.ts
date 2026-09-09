import { createEffect, S } from "envio";

type HistoricalPricePoint = {
  x: number
  y: number
}

interface HistoricalAssetPriceResponse {
  data: {
    assetByAddress: {
      historicalPriceUsd: HistoricalPricePoint[]
    } | null
  }
  errors?: any
}

// Define the schema for the effect output
const getMorphoHistoricalPriceSchema = S.schema({
  price: S.number,
})

// Infer the type from the schema
type getMorphoHistoricalPrice = S.Infer<typeof getMorphoHistoricalPriceSchema>;

export const getMorphoHistoricalPrice = createEffect(
  {
    name: "getMorphoHistoricalPrice",
    input: {
      assetAddress: S.string,
      chainId: S.number,
      timestamp: S.bigint,
    },
    output: getMorphoHistoricalPriceSchema,
    // Enable caching to avoid duplicated calls
    cache: true,
    rateLimit: {
      calls: 100,
      per: "second"
    },
  },
  async ({ input, context }) => {
    const { assetAddress, chainId, timestamp } = input

    // Calculate the closest full hour before the liquidation timestamp
    const liquidationTimestamp = Number(timestamp)
    const hourTimestamp = Math.floor(liquidationTimestamp / 3600) * 3600

    const query = `
      query HistoricalAssetPrice($address: String!, $chainId: Int!, $start: Int!, $end: Int!) {
        assetByAddress(address: $address, chainId: $chainId) {
          historicalPriceUsd(options: { startTimestamp: $start, endTimestamp: $end, interval: HOUR }) {
            x
            y
          }
        }
      }
    `

    const variables = {
      address: assetAddress,
      chainId,
      start: hourTimestamp,
      end: hourTimestamp + 3600, // End of the hour
    }

    try {
      const response = await fetch("https://api.morpho.org/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      })

      const json = await response.json() as HistoricalAssetPriceResponse

      if (json.errors) {
        console.error("Morpho GraphQL errors:", json.errors)
        context.cache = false
        return { price: 0 }
      }

      const historicalPriceUsd = json.data?.assetByAddress?.historicalPriceUsd

      if (!historicalPriceUsd || historicalPriceUsd.length === 0) {
        console.warn(`No price data found for asset ${assetAddress} at timestamp ${hourTimestamp}`)
        return { price: 0 }
      }

      // Get the price at the exact hour (should be the first/only data point)
      const price = historicalPriceUsd[0]?.y

      if (!price) {
        console.warn(`Invalid price data for asset ${assetAddress} at timestamp ${hourTimestamp}`)
        return { price: 0 }
      }

      return { price }
    } catch (error) {
      console.error(`Failed to fetch Morpho price for asset ${assetAddress}:`, error)
      context.cache = false
      return { price: 0 }
    }
  }
);
