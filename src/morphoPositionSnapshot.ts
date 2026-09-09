import { createEffect, S } from "envio";
import { executeWithRPCRotation } from "./utils";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load Morpho Blue ABI
const morphoBlueAbi = JSON.parse(
  readFileSync(join(__dirname, "../abis/Morpho.json"), "utf8")
);

// Load Morpho Oracle ABI
const morphoOracleAbi = JSON.parse(
  readFileSync(join(__dirname, "../abis/MorphoOracle.json"), "utf8")
);

function getMorphoBlueContract(address: string) {
  return { address: address as `0x${string}`, abi: morphoBlueAbi };
}

function getMorphoOracleContract(address: string) {
  return { address: address as `0x${string}`, abi: morphoOracleAbi };
}

// Define schema for position data
const morphoPositionSchema = S.schema({
  collateralAmount: S.bigint,
  borrowAmount: S.bigint,
  supplyShares: S.bigint,
});

// Infer the type from the schema
type MorphoPositionData = S.Infer<typeof morphoPositionSchema>;

export const getMorphoUserPositionData = createEffect(
  {
    name: "getMorphoUserPositionData",
    input: {
      userAddress: S.string,
      marketId: S.string,
      morphoAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: morphoPositionSchema,
    cache: true,
    rateLimit: {
      calls: 100,
      per: "second"
    },
  },
  async ({ input }) => {
    const { userAddress, marketId, morphoAddress, chainId, blockNumber } = input;

    const morphoContract = getMorphoBlueContract(morphoAddress);

    try {
      // 1. Get user position
      const positionResult = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...morphoContract,
            functionName: "position",
            args: [marketId, userAddress],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      // 2. Get market state (for share conversion)
      const marketResult = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...morphoContract,
            functionName: "market",
            args: [marketId],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      const position = positionResult as any;
      const market = marketResult as any;

      // Extract position data from tuple
      const supplyShares = BigInt(position[0] || 0);
      const borrowShares = BigInt(position[1] || 0);
      const collateral = BigInt(position[2] || 0);

      // Extract market data for share conversion
      const totalBorrowAssets = BigInt(market[2] || 0);  // market.totalBorrowAssets
      const totalBorrowShares = BigInt(market[3] || 0);  // market.totalBorrowShares

      // Convert borrowShares to actual borrow amount
      let borrowAmount = 0n;
      if (borrowShares > 0n && totalBorrowShares > 0n) {
        borrowAmount = (borrowShares * totalBorrowAssets) / totalBorrowShares;
      }

      return {
        collateralAmount: collateral,
        borrowAmount: borrowAmount,
        supplyShares: supplyShares,
      };

    } catch (error) {
      console.error(
        `Failed to fetch Morpho position for ${userAddress} in market ${marketId} at block ${blockNumber}. Error: ${error}`
      );
      return {
        collateralAmount: 0n,
        borrowAmount: 0n,
        supplyShares: 0n,
      };
    }
  }
);

// Define schema for oracle price
const morphoOraclePriceSchema = S.schema({
  price: S.bigint,
});

// Infer the type from the schema
type MorphoOraclePriceData = S.Infer<typeof morphoOraclePriceSchema>;

export const getMorphoOraclePrice = createEffect(
  {
    name: "getMorphoOraclePrice",
    input: {
      oracleAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: morphoOraclePriceSchema,
    cache: true,
    rateLimit: {
      calls: 100,
      per: "second"
    },
  },
  async ({ input, context }) => {
    const { oracleAddress, chainId, blockNumber } = input;

    const oracleContract = getMorphoOracleContract(oracleAddress);

    try {
      const priceResult = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...oracleContract,
            functionName: "price",
            args: [],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      return {
        price: BigInt(priceResult as any),
      };
    } catch (error) {
      console.error(
        `Failed to fetch Morpho oracle price from ${oracleAddress} at block ${blockNumber}. Error: ${error}`
      );
      context.cache = false
      return {
        price: 0n,
      };
    }
  }
);
