import { experimental_createEffect, S } from "envio";
import { 
  executeWithRPCRotation,
  getAccountLensContract, 
  getEulerAccountLensAddress, 
  getEulerEVCAddress,
} from "./utils";

// Define schema for VaultAccountInfo (simplified - only fields we need)
const vaultAccountInfoSchema = S.schema({
  vault: S.string,
  asset: S.string,
  assetsAccount: S.bigint,
  assets: S.bigint,  // Actual asset balance (use this for collateral)
  borrowed: S.bigint,
  isController: S.boolean,
  isCollateral: S.boolean,
  liquidityInfo: S.schema({
    queryFailure: S.boolean,
    liabilityValue: S.bigint,
    collateralValueBorrowing: S.bigint,
    collateralValueLiquidation: S.bigint,
    collateralLiquidityLiquidationInfo: S.array(S.schema({
      collateral: S.string,  // vault address
      collateralValue: S.bigint,
    })),
  }),
});

// Define the schema for the effect output
const getUserPositionDataSchema = S.schema({
  vaultAccountInfos: S.array(vaultAccountInfoSchema),
});

// Infer the type from the schema
type GetEulerUserPositionData = S.Infer<typeof getUserPositionDataSchema>;

export const getEulerUserPositionData = experimental_createEffect(
  {
    name: "getEulerUserPositionData",
    input: {
      userAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: getUserPositionDataSchema,
    cache: true,
  },
  async ({ input }) => {
    const { userAddress, chainId, blockNumber } = input;

    const accountLensAddress = getEulerAccountLensAddress(chainId);
    const evcAddress = getEulerEVCAddress(chainId);

    if (!accountLensAddress || !evcAddress) {
      console.error(
        `Missing AccountLens or EVC address for chain ${chainId}`
      );
      return {
        vaultAccountInfos: [],
      };
    }

    const accountLensContract = getAccountLensContract(
      accountLensAddress as `0x${string}`,
      chainId
    );

    try {
      const result = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...accountLensContract,
            functionName: "getAccountEnabledVaultsInfo",
            args: [evcAddress, userAddress],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      // Result structure: AccountMultipleVaultsInfo
      // {
      //   evcAccountInfo: {...},
      //   vaultAccountInfo: VaultAccountInfo[],
      //   accountRewardInfo: [...]
      // }
      const accountMultipleVaultsInfo = result as any;
      const vaultAccountInfos = accountMultipleVaultsInfo.vaultAccountInfo || [];

      // Map the raw data to our schema format
      const mappedVaultInfos = vaultAccountInfos.map((vaultInfo: any) => ({
        vault: vaultInfo.vault,
        asset: vaultInfo.asset,
        assetsAccount: BigInt(vaultInfo.assetsAccount),
        assets: BigInt(vaultInfo.assets),
        borrowed: BigInt(vaultInfo.borrowed),
        isController: vaultInfo.isController,
        isCollateral: vaultInfo.isCollateral,
        liquidityInfo: {
          queryFailure: vaultInfo.liquidityInfo.queryFailure,
          liabilityValue: BigInt(vaultInfo.liquidityInfo.liabilityValue || 0),
          collateralValueBorrowing: BigInt(vaultInfo.liquidityInfo.collateralValueBorrowing || 0),
          collateralValueLiquidation: BigInt(vaultInfo.liquidityInfo.collateralValueLiquidation || 0),
          collateralLiquidityLiquidationInfo: (vaultInfo.liquidityInfo.collateralLiquidityLiquidationInfo || []).map((coll: any) => ({
            collateral: coll.collateral,
            collateralValue: BigInt(coll.collateralValue),
          })),
        },
      }));

      return {
        vaultAccountInfos: mappedVaultInfos,
      };
    } catch (error) {
      console.error(
        `Failed to fetch Euler user position data for ${userAddress} on chain ${chainId} at block ${blockNumber}. Error: ${error}`
      );
      // Return empty data on failure
      return {
        vaultAccountInfos: [],
      };
    }
  }
);

