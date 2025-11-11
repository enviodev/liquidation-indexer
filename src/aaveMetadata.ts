import { createEffect, S } from "envio";
import { 
  executeWithRPCRotation,
  getAaveV3ProtocolDataProviderAddress,
  getAaveV3ProtocolDataProviderContract
} from "./utils";

// Define the schema for the effect output
const getAaveV3ReserveDataSchema = S.schema({
  decimals: S.number,
  ltv: S.bigint,
  cf: S.bigint,
  liq_inc: S.bigint,
  reserve_factor: S.bigint,
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
      const ltv = BigInt(reservesData[2]);
      const cf = BigInt(5000n);
      const liq_inc = BigInt(reservesData[3]);
      const reserve_factor = BigInt(reservesData[4]);

      if (ltv === 0n) {
        context.cache = false
      }

      return {
        decimals: decimals,
        ltv: ltv,
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
        ltv: 0n,
        cf: 0n,
        liq_inc: 0n,
        reserve_factor: 0n,
      };
    }
  }
);
