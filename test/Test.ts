import { describe, expect, it } from "vitest";
import { TestHelpers, AaveProxy_LiquidationCall } from "generated";
const { MockDb, AaveProxy } = TestHelpers;

describe("AaveProxy contract LiquidationCall event tests", () => {
  const mockDb = MockDb.createMockDb();

  const event = AaveProxy.LiquidationCall.createMockEvent({});

  it("AaveProxy_LiquidationCall is created correctly", async () => {
    const mockDbUpdated = await AaveProxy.LiquidationCall.processEvent({
      event,
      mockDb,
    });

    const actual = mockDbUpdated.entities.AaveProxy_LiquidationCall.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    const expected: AaveProxy_LiquidationCall = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
      collateralAsset: event.params.collateralAsset,
      debtAsset: event.params.debtAsset,
      user: event.params.user,
      debtToCover: event.params.debtToCover,
      liquidatedCollateralAmount: event.params.liquidatedCollateralAmount,
      liquidator: event.params.liquidator,
      receiveAToken: event.params.receiveAToken,
    };

    expect(actual).toEqual(expected);
  });
});
