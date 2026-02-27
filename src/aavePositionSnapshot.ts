import { createEffect, S } from "envio";
import {
  executeWithRPCRotation,
  getAaveUiPoolDataProviderContract,
  getAaveV3UiPoolDataProviderAddress,
  getAaveV3PoolAddressesProviderAddress,
  getAaveV3ProtocolDataProviderAddress,
  getAaveV3ProtocolDataProviderContract,
  getAaveV3PoolContract,
  getAavePoolAddressesProviderContract,
  isAssetEnabledInEModeBitmap,
} from "./utils";

// Define the schema for a single user reserve
const userReserveDataSchema = S.schema({
  underlyingAsset: S.string,
  scaledATokenBalance: S.bigint,
  usageAsCollateralEnabledOnUser: S.boolean,
  scaledVariableDebt: S.bigint,
  currentVariableDebt: S.bigint,  // Actual debt with accrued interest
  reserveId: S.number,  // Reserve ID for bitmap checking
  liquidationThreshold: S.bigint,  // Effective liquidation threshold (EMode or default)
});

// Define the schema for the effect output
const getUserPositionDataSchema = S.schema({
  userReserves: S.array(userReserveDataSchema),
  eModeCategory: S.number,
});

// Infer the type from the schema
type GetUserPositionData = S.Infer<typeof getUserPositionDataSchema>;

export const getAaveUserPositionData = createEffect(
  {
    name: "getAaveUserPositionData",
    input: {
      userAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: getUserPositionDataSchema,
    cache: true,
    rateLimit: {
      calls: 100,
      per: "second"
    },
  },
  async ({ input, context }) => {
    const { userAddress, chainId, blockNumber } = input;

    try {
      // Get Pool address from PoolAddressesProvider
      const poolAddressesProviderAddress = getAaveV3PoolAddressesProviderAddress(chainId);
      const poolAddressesProviderContract = getAavePoolAddressesProviderContract(
        poolAddressesProviderAddress as `0x${string}`
      );

      const poolAddress = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...poolAddressesProviderContract,
            functionName: "getPool",
            args: [],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      ) as `0x${string}`;

      const poolContract = getAaveV3PoolContract(poolAddress);

      // Fetch user's EMode category
      const userEModeCategory = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...poolContract,
            functionName: "getUserEMode",
            args: [userAddress as `0x${string}`],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      ) as bigint;

      const eModeCategory = Number(userEModeCategory);

      // If user is in EMode, fetch EMode category data
      let eModeCategoryData: any = null;
      if (eModeCategory > 0) {
        eModeCategoryData = await executeWithRPCRotation(
          chainId,
          async (client) => {
            return await client.readContract({
              ...poolContract,
              functionName: "getEModeCategoryData",
              args: [eModeCategory],
              blockNumber: BigInt(blockNumber),
            });
          },
          { enableBatch: false, enableMulticall: false }
        );
      }

      // Use AaveV3 protocol data provider
      const protocolDataProviderAddress = getAaveV3ProtocolDataProviderAddress(chainId);
      const protocolDataProviderContract = getAaveV3ProtocolDataProviderContract(
        protocolDataProviderAddress as `0x${string}`
      );

      // Step 1: Get the list of all reserves
      const allReservesResult = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...protocolDataProviderContract,
            functionName: "getAllReservesTokens",
            args: [],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      const allReserves = allReservesResult as Array<{ symbol: string; tokenAddress: string }>;

      // Step 2: Get the user position data for each reserve using multicall
      const userReserves = [];

      // Build multicall contracts array for all reserves (user data + reserve data + reserve config)
      const multicallContracts = allReserves.flatMap((reserve) => [
        // getUserReserveData
        {
          ...protocolDataProviderContract,
          functionName: "getUserReserveData" as const,
          args: [reserve.tokenAddress as `0x${string}`, userAddress as `0x${string}`],
        },
        // getReserveData to get reserve ID
        {
          ...poolContract,
          functionName: "getReserveData" as const,
          args: [reserve.tokenAddress as `0x${string}`],
        },
        // getReserveConfigurationData to get liquidation threshold
        {
          ...protocolDataProviderContract,
          functionName: "getReserveConfigurationData" as const,
          args: [reserve.tokenAddress as `0x${string}`],
        },
      ]);

      // Execute all calls in a single multicall
      const allMulticallData = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.multicall({
            allowFailure: true,
            contracts: multicallContracts,
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: true, enableMulticall: true }
      );

      // Step 3: Process results and filter out empty positions
      for (let i = 0; i < allReserves.length; i++) {
        const userDataResult = allMulticallData[i * 3];
        const reserveDataResult = allMulticallData[i * 3 + 1];
        const reserveConfigResult = allMulticallData[i * 3 + 2];

        // Skip if any call failed
        if (userDataResult.status === 'failure' || reserveDataResult.status === 'failure' || reserveConfigResult.status === 'failure') {
          continue;
        }

        const [
          currentATokenBalance,
          _currentStableDebt,
          currentVariableDebt,  // Actual debt with accrued interest
          _principalStableDebt,
          scaledVariableDebt,   // Principal debt without interest
          _stableBorrowRate,
          _liquidityRate,
          _stableRateLastUpdated,
          usageAsCollateralEnabled,
        ] = userDataResult.result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, boolean];

        // Extract reserve ID from reserve data
        const reserveData = reserveDataResult.result as any;
        const reserveId = Number(reserveData.id);

        // Extract liquidation threshold from reserve config (in basis points, e.g., 8000 = 80%)
        const reserveConfig = reserveConfigResult.result as any;
        const defaultLiquidationThreshold = BigInt(reserveConfig[2]); // liquidationThreshold is at index 2

        // Determine effective liquidation threshold
        let effectiveLiquidationThreshold = defaultLiquidationThreshold;

        if (eModeCategory > 0 && eModeCategoryData) {
          // Check if asset is eligible as collateral in this EMode
          const isEModeCollateral = isAssetEnabledInEModeBitmap(
            BigInt(eModeCategoryData.collateralBitmap),
            reserveId
          );

          // If eligible, use EMode liquidation threshold
          if (isEModeCollateral) {
            effectiveLiquidationThreshold = BigInt(eModeCategoryData.liquidationThreshold);
          }
        }

        // Use aTokenBalance as scaledATokenBalance, filter out empty positions
        if (currentATokenBalance > 0n || currentVariableDebt > 0n) {
          userReserves.push({
            underlyingAsset: allReserves[i].tokenAddress,
            scaledATokenBalance: currentATokenBalance,
            usageAsCollateralEnabledOnUser: usageAsCollateralEnabled,
            scaledVariableDebt: scaledVariableDebt,
            currentVariableDebt: currentVariableDebt,
            reserveId: reserveId,
            liquidationThreshold: effectiveLiquidationThreshold,
          });
        }
      }

      return {
        userReserves,
        eModeCategory: eModeCategory,
      };
    } catch (primaryError) {
      context.log.error(`PRIMARY method failed, attempting FALLBACK`, {
        userAddress, chainId, blockNumber: blockNumber.toString(),
        error: primaryError instanceof Error ? primaryError.message : String(primaryError)
      });

      try {
        const poolDataProviderAddress = getAaveV3UiPoolDataProviderAddress(chainId);
        const poolAddressesProviderAddress = getAaveV3PoolAddressesProviderAddress(chainId);

        const poolDataProviderContract = getAaveUiPoolDataProviderContract(
          poolDataProviderAddress as `0x${string}`
        );

        // Get Pool address for fetching reserve data
        const poolAddressesProviderContract = getAavePoolAddressesProviderContract(
          poolAddressesProviderAddress as `0x${string}`
        );

        const poolAddress = await executeWithRPCRotation(
          chainId,
          async (client) => {
            return await client.readContract({
              ...poolAddressesProviderContract,
              functionName: "getPool",
              args: [],
              blockNumber: BigInt(blockNumber),
            });
          },
          { enableBatch: false, enableMulticall: false }
        ) as `0x${string}`;

        const poolContract = getAaveV3PoolContract(poolAddress);

        const result = await executeWithRPCRotation(
          chainId,
          async (client) => {
            return await client.readContract({
              ...poolDataProviderContract,
              functionName: "getUserReservesData",
              args: [poolAddressesProviderAddress, userAddress],
              blockNumber: BigInt(blockNumber),
            });
          },
          { enableBatch: false, enableMulticall: false }
        );

        const [userReservesData, eModeCategory] = result as [any[], number];

        // Fetch EMode category data if user is in EMode
        let eModeCategoryData: any = null;
        if (Number(eModeCategory) > 0) {
          eModeCategoryData = await executeWithRPCRotation(
            chainId,
            async (client) => {
              return await client.readContract({
                ...poolContract,
                functionName: "getEModeCategoryData",
                args: [Number(eModeCategory)],
                blockNumber: BigInt(blockNumber),
              });
            },
            { enableBatch: false, enableMulticall: false }
          );
        }

        // Build multicall to get reserve data for each asset
        const reserveMulticallContracts = userReservesData.flatMap((reserve: any) => [
          {
            ...poolContract,
            functionName: "getReserveData" as const,
            args: [reserve.underlyingAsset as `0x${string}`],
          },
        ]);

        const reserveDataResults = await executeWithRPCRotation(
          chainId,
          async (client) => {
            return await client.multicall({
              allowFailure: true,
              contracts: reserveMulticallContracts,
              blockNumber: BigInt(blockNumber),
            });
          },
          { enableBatch: true, enableMulticall: true }
        );

        // Map the raw data to our schema format
        const userReserves = userReservesData.map((reserve: any, index: number) => {
          const reserveDataResult = reserveDataResults[index];

          // Default values in case of failure
          let reserveId = 0;
          let liquidationThreshold = BigInt(reserve.reserveLiquidationThreshold || 0);

          if (reserveDataResult.status === 'success') {
            const reserveData = reserveDataResult.result as any;
            reserveId = Number(reserveData.id);

            // Check if asset is eligible for EMode
            if (Number(eModeCategory) > 0 && eModeCategoryData) {
              const isEModeCollateral = isAssetEnabledInEModeBitmap(
                BigInt(eModeCategoryData.collateralBitmap),
                reserveId
              );

              if (isEModeCollateral) {
                liquidationThreshold = BigInt(eModeCategoryData.liquidationThreshold);
              }
            }
          }

          const currentVariableDebtValue = reserve.currentVariableDebt !== undefined && reserve.currentVariableDebt !== null
            ? BigInt(reserve.currentVariableDebt)
            : BigInt(reserve.scaledVariableDebt || 0);

          return {
            underlyingAsset: reserve.underlyingAsset,
            scaledATokenBalance: BigInt(reserve.scaledATokenBalance),
            usageAsCollateralEnabledOnUser: Boolean(reserve.usageAsCollateralEnabledOnUser),
            scaledVariableDebt: BigInt(reserve.scaledVariableDebt),
            currentVariableDebt: currentVariableDebtValue,
            reserveId: reserveId,
            liquidationThreshold: liquidationThreshold,
          };
        });

        return {
          userReserves,
          eModeCategory: Number(eModeCategory),
        };
      } catch (fallbackError) {
        context.log.error(`FALLBACK method also failed`, {
          userAddress, chainId, blockNumber: blockNumber.toString(),
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        context.cache = false
        // Return empty data when both methods fail
        return {
          userReserves: [],
          eModeCategory: 0,
        };
      }
    }
  }
);
