import { createEffect, S } from "envio";
import { 
  executeWithRPCRotation,
  getAaveUiPoolDataProviderContract, 
  getAaveV3UiPoolDataProviderAddress, 
  getAaveV3PoolAddressesProviderAddress,
  getAaveV3ProtocolDataProviderAddress,
  getAaveV3ProtocolDataProviderContract,
} from "./utils";

// Define the schema for a single user reserve
const userReserveDataSchema = S.schema({
  underlyingAsset: S.string,
  scaledATokenBalance: S.bigint,
  usageAsCollateralEnabledOnUser: S.boolean,
  scaledVariableDebt: S.bigint,
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
      // Fallback: Use AaveV3 protocol data provider
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
      
      // Build multicall contracts array for all reserves
      const multicallContracts = allReserves.map((reserve) => ({
        ...protocolDataProviderContract,
        functionName: "getUserReserveData" as const,
        args: [reserve.tokenAddress as `0x${string}`, userAddress as `0x${string}`],
      }));

      // Execute all getUserReserveData calls in a single multicall
      const allUserReserveData = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.multicall({
            allowFailure: true, // Allow individual calls to fail without breaking the whole batch
            contracts: multicallContracts,
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: true, enableMulticall: true }
      );

      // Step 3: Process results and filter out empty positions
      for (let i = 0; i < allReserves.length; i++) {
        const result = allUserReserveData[i];
        
        // Skip failed calls
        if (result.status === 'failure') {
          continue;
        }

        const [
          currentATokenBalance,
          _currentStableDebt,
          _currentVariableDebt,
          _principalStableDebt,
          scaledVariableDebt,
          _stableBorrowRate,
          _liquidityRate,
          _stableRateLastUpdated,
          usageAsCollateralEnabled,
        ] = result.result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, boolean];

        // Use aTokenBalance as scaledATokenBalance, filter out empty positions
        if (currentATokenBalance > 0n || scaledVariableDebt > 0n) {
          userReserves.push({
            underlyingAsset: allReserves[i].tokenAddress,
            scaledATokenBalance: currentATokenBalance,
            usageAsCollateralEnabledOnUser: usageAsCollateralEnabled,
            scaledVariableDebt: scaledVariableDebt,
          });
        }
      }

      // eModeCategory is not available from ProtocolDataProvider, default to 0
      return {
        userReserves,
        eModeCategory: 0,
      };
    } catch (primaryError) {
      // console.error(
      //   `Primary method failed for user ${userAddress} on chain ${chainId} at block ${blockNumber}. Attempting fallback method. Error: ${primaryError}`
      // );

      try {


        const poolDataProviderAddress = getAaveV3UiPoolDataProviderAddress(chainId);
        const poolAddressesProviderAddress = getAaveV3PoolAddressesProviderAddress(chainId);

        const poolDataProviderContract = getAaveUiPoolDataProviderContract(
          poolDataProviderAddress as `0x${string}`
        );
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

        // Map the raw data to our schema format
        const userReserves = userReservesData.map((reserve: any) => ({
          underlyingAsset: reserve.underlyingAsset,
          scaledATokenBalance: BigInt(reserve.scaledATokenBalance), // The scaled balance of the aToken. scaledBalance = balance/liquidityIndex
          usageAsCollateralEnabledOnUser: Boolean(reserve.usageAsCollateralEnabledOnUser),
          scaledVariableDebt: BigInt(reserve.scaledVariableDebt), // The scaled balance of borrow position: (current balance = scaled balance * liquidity index)
        }));

        return {
          userReserves,
          eModeCategory: Number(eModeCategory),
        };
      } catch (fallbackError) {
        console.error(
          `Fallback method also failed for user ${userAddress} on chain ${chainId} at block ${blockNumber}. Error: ${fallbackError}`
        );
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

