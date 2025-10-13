import { experimental_createEffect, S } from "envio";
import { 
  executeWithRPCRotation,
  getAaveUiPoolDataProviderContract, 
  getAaveV3UiPoolDataProviderAddress, 
  getAaveV3PoolAddressesProviderAddress,
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

export const getAaveUserPositionData = experimental_createEffect(
  {
    name: "getAaveUserPositionData",
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

    const poolDataProviderAddress = getAaveV3UiPoolDataProviderAddress(chainId);
    const poolAddressesProviderAddress = getAaveV3PoolAddressesProviderAddress(chainId);

    const poolDataProviderContract = getAaveUiPoolDataProviderContract(
      poolDataProviderAddress as `0x${string}`
    );

    try {
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
        scaledATokenBalance: BigInt(reserve.scaledATokenBalance),
        usageAsCollateralEnabledOnUser: Boolean(reserve.usageAsCollateralEnabledOnUser),
        scaledVariableDebt: BigInt(reserve.scaledVariableDebt),
      }));

      return {
        userReserves,
        eModeCategory: Number(eModeCategory),
      };
    } catch (error) {
      console.error(
        `Failed to fetch user position data for ${userAddress} on chain ${chainId} at block ${blockNumber}. Error: ${error}`
      );
      // Return empty data on failure
      return {
        userReserves: [],
        eModeCategory: 0,
      };
    }
  }
);

