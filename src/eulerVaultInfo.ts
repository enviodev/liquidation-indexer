import { experimental_createEffect, S } from "envio";
import * as fs from "fs";
import * as path from "path";
import {
  executeWithRPCRotation,
  getEulerVaultLensAddress,
} from "./utils";

// Load the EulerVaultLens ABI
const eulerVaultLensAbi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../abis/EulerVaultLens.json"), "utf8")
);

function getEulerVaultLensContract(address: `0x${string}`) {
  return { address, abi: eulerVaultLensAbi };
}

// Define schema for LTV info output
const vaultLtvInfoSchema = S.schema({
  liquidationLTV: S.bigint,
  borrowLTV: S.bigint,
  initialLiquidationLTV: S.bigint,
  targetTimestamp: S.bigint,
  rampDuration: S.bigint,
});

// Infer the type from the schema
type VaultLtvInfo = S.Infer<typeof vaultLtvInfoSchema>;

export const getEulerVaultLtvInfo = experimental_createEffect(
  {
    name: "getEulerVaultLtvInfo",
    input: {
      debtVaultAddress: S.string,
      collateralVaultAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: vaultLtvInfoSchema,
    cache: true,
  },
  async ({ input }) => {
    const { debtVaultAddress, collateralVaultAddress, chainId, blockNumber } = input;

    const vaultLensAddress = getEulerVaultLensAddress(chainId);

    if (!vaultLensAddress) {
      console.error(`Missing VaultLens address for chain ${chainId}`);
      throw new Error(`VaultLens not available for chain ${chainId}`);
    }

    const vaultLensContract = getEulerVaultLensContract(
      vaultLensAddress as `0x${string}`
    );

    try {
      const result = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...vaultLensContract,
            functionName: "getVaultInfoFull",
            args: [debtVaultAddress],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      // Result structure: VaultInfoFull
      // Contains collateralLTVInfo: LTVInfo[]
      const vaultInfoFull = result as any;
      const collateralLTVInfo = vaultInfoFull.collateralLTVInfo || [];

      // Find the LTV info for the matching collateral vault
      const matchingLtvInfo = collateralLTVInfo.find(
        (ltvInfo: any) =>
          ltvInfo.collateral.toLowerCase() === collateralVaultAddress.toLowerCase()
      );

      if (!matchingLtvInfo) {
        console.error(
          `No LTV info found for collateral ${collateralVaultAddress} in debt vault ${debtVaultAddress}`
        );
        throw new Error(
          `Collateral ${collateralVaultAddress} not recognized by debt vault ${debtVaultAddress}`
        );
      }

      // Return the LTV information
      return {
        liquidationLTV: BigInt(matchingLtvInfo.liquidationLTV),
        borrowLTV: BigInt(matchingLtvInfo.borrowLTV),
        initialLiquidationLTV: BigInt(matchingLtvInfo.initialLiquidationLTV),
        targetTimestamp: BigInt(matchingLtvInfo.targetTimestamp),
        rampDuration: BigInt(matchingLtvInfo.rampDuration),
      };
    } catch (error) {
      console.error(
        `Failed to fetch Euler vault LTV info for debt vault ${debtVaultAddress}, collateral ${collateralVaultAddress} on chain ${chainId} at block ${blockNumber}. Error: ${error}`
      );
      throw error;
    }
  }
);
