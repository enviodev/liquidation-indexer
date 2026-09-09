import { describe, it, expect } from "vitest";
import { createTestIndexer, TestHelpers, type AaveProxy_LiquidationCall } from "envio";

const { Addresses } = TestHelpers;

describe("AaveProxy LiquidationCall", () => {
  it("stores an AaveProxy_LiquidationCall entity", async () => {
    const indexer = createTestIndexer();

    const params = {
      collateralAsset: Addresses.mockAddresses[0],
      debtAsset: Addresses.mockAddresses[1],
      user: Addresses.mockAddresses[2],
      debtToCover: 1000n,
      liquidatedCollateralAmount: 2000n,
      liquidator: Addresses.mockAddresses[3],
      receiveAToken: false,
    };
    const chainId = 1;
    const blockNumber = 16291126;
    const timestamp = 1672531200;

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "AaveProxy",
              event: "LiquidationCall",
              params,
              block: { number: blockNumber, timestamp },
              logIndex: 0,
            },
          ],
        },
      },
    });

    const id = `${chainId}_${blockNumber}_0`;
    const actual = await indexer.AaveProxy_LiquidationCall.getOrThrow(id);

    const expected: AaveProxy_LiquidationCall = {
      id,
      chainId,
      timestamp: BigInt(timestamp),
      collateralAsset: params.collateralAsset,
      debtAsset: params.debtAsset,
      user: params.user,
      debtToCover: params.debtToCover,
      liquidatedCollateralAmount: params.liquidatedCollateralAmount,
      liquidator: params.liquidator,
      receiveAToken: params.receiveAToken,
    };

    expect(actual).toEqual(expected);
  });
});
