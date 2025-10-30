import { Liquidator, Borrower } from "generated";

// Helper function to update liquidator data
export async function updateLiquidatorData(
  context: any,
  liquidator: string,
  chainId: number,
  protocol: "Aave" | "Euler" | "Morpho",
  timestamp: bigint
) {
  const liquidatorId = `${liquidator}_${chainId}`;
  const existing = await context.Liquidator.get(liquidatorId);

  const liquidatorData: Liquidator = {
    id: liquidatorId,
    liquidator: liquidator,
    chainId: chainId,
    aaveLiquidations:
      BigInt(existing?.aaveLiquidations ?? 0n) +
      (protocol === "Aave" ? 1n : 0n),
    eulerLiquidations:
      BigInt(existing?.eulerLiquidations ?? 0n) +
      (protocol === "Euler" ? 1n : 0n),
    morphoLiquidations:
      BigInt(existing?.morphoLiquidations ?? 0n) +
      (protocol === "Morpho" ? 1n : 0n),
    totalLiquidations: BigInt(existing?.totalLiquidations ?? 0n) + 1n,
    firstLiquidationTimestamp: existing?.firstLiquidationTimestamp ?? timestamp,
    lastLiquidationTimestamp: timestamp,
  };

  context.Liquidator.set(liquidatorData);
  return liquidatorId;
}

// Helper function to update borrower data
export async function updateBorrowerData(
  context: any,
  borrower: string,
  chainId: number,
  protocol: "Aave" | "Euler" | "Morpho",
  timestamp: bigint
) {
  const borrowerId = `${borrower}_${chainId}`;
  const existing = await context.Borrower.get(borrowerId);

  const borrowerData: Borrower = {
    id: borrowerId,
    borrower: borrower,
    chainId: chainId,
    aaveLiquidations:
      BigInt(existing?.aaveLiquidations ?? 0n) +
      (protocol === "Aave" ? 1n : 0n),
    eulerLiquidations:
      BigInt(existing?.eulerLiquidations ?? 0n) +
      (protocol === "Euler" ? 1n : 0n),
    morphoLiquidations:
      BigInt(existing?.morphoLiquidations ?? 0n) +
      (protocol === "Morpho" ? 1n : 0n),
    totalLiquidations: BigInt(existing?.totalLiquidations ?? 0n) + 1n,
    firstLiquidationTimestamp: existing?.firstLiquidationTimestamp ?? timestamp,
    lastLiquidationTimestamp: timestamp,
  };

  context.Borrower.set(borrowerData);
  return borrowerId;
}
