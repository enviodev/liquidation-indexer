import { createEffect, S } from "envio";
import { 
  executeWithRPCRotation,
  getAaveV3ProtocolDataProviderAddress,
  getAaveV3ProtocolDataProviderContract
} from "./utils";

// Define the schema for the effect output
const getAaveV3ReserveDataSchema = S.schema({
  decimals: S.number,
  liqLTV: S.number,
  cf: S.number,
  liq_inc: S.number,
  reserve_factor: S.number,
});

// Infer the type from the schema
type getAaveV3ReserveData = S.Infer<typeof getAaveV3ReserveDataSchema>;

export const getAaveV3ReserveData = createEffect(
  {
    name: "getAaveV3ReserveData",
    input: {
      tokenAddress: S.string,
      chainId: S.number,
      blockNumber: S.bigint,
    },
    output: getAaveV3ReserveDataSchema,
    // Enable caching to avoid duplicated calls
    cache: true,
    rateLimit: {
      calls: 100,
      per: "second"
    },
  },
  async ({ input, context }) => {
    const { tokenAddress, chainId, blockNumber } = input;

    try {
      // Try fallback method with RPC rotation
      const protocolDataProviderAddress = getAaveV3ProtocolDataProviderAddress(chainId);
      const protocolDataProviderContract = getAaveV3ProtocolDataProviderContract(
        protocolDataProviderAddress as `0x${string}`
      );

      const result = await executeWithRPCRotation(
        chainId,
        async (client) => {
          return await client.readContract({
            ...protocolDataProviderContract,
            functionName: "getReserveConfigurationData",
            args: [tokenAddress],
            blockNumber: BigInt(blockNumber),
          });
        },
        { enableBatch: false, enableMulticall: false }
      );

      const reservesData = result as any;
      const decimals = Number(reservesData[0]);
      const liqLTV = Number(reservesData[2]);
      const cf = Number(reservesData[1]);
      const liq_inc = Number(reservesData[3]);
      const reserve_factor = Number(reservesData[4]);

      if (liqLTV === 0) {
        context.cache = false
      }

      return {
        decimals: decimals,
        liqLTV: liqLTV,
        cf: cf,
        liq_inc: liq_inc,
        reserve_factor: reserve_factor,
      };

    } catch (error) {
      console.log(
        `Failed to getAaveV3ReserveData on chain ${chainId}. ` +
        `Token: ${tokenAddress}, Block: ${blockNumber}. Error: ${error}`
      );
      context.cache = false
      return {
        decimals: 0,
        liqLTV: 0,
        cf: 0,
        liq_inc: 0,
        reserve_factor: 0,
      };
    }
  }
);
