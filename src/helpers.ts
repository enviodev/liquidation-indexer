import { Liquidator, Borrower } from "generated";
import { getAaveUserPositionData } from "./aavePositionSnapshot";
import { getEulerUserPositionData } from "./eulerPositionSnapshot";
import { getTokenDetails } from "./tokenDetails";
import { getAssetPrice } from "./aaveOracle";
import { getQuote } from "./evaultOracle";
import { getEulerUSDAddress } from "./utils";

interface ProcessedCollateral {
  id: string;
  asset: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  amountUSD: number | undefined;
  enabledAsCollateral: boolean;
  isSeized: boolean;
}

interface ProcessedDebt {
  id: string;
  asset: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  amountUSD: number | undefined;
  isRepaid: boolean;
}

interface PositionSnapshotData {
  collaterals: ProcessedCollateral[];
  debts: ProcessedDebt[];
  totalCollateralUSD: number;
  totalDebtUSD: number;
  ltv: number | undefined;
  effectiveLiqLtv: number | undefined;
  eModeCategory: number;
}

export async function processAavePositionSnapshot(
  context: any,
  userAddress: string,
  chainId: number,
  blockNumber: bigint,
  priceBlockNumber: bigint,
  seizedAsset: string,
  repaidAsset: string,
  snapshotId: string
): Promise<PositionSnapshotData> {

  // Fetch user position data at blockNumber (N-1, pre-liquidation state)
  const positionData = await context.effect(getAaveUserPositionData, {
    userAddress,
    chainId,
    blockNumber,
  });

  if (positionData.userReserves.length === 0) {
    context.log.warn(
      `No position data found for user ${userAddress} on chain ${chainId} at block ${blockNumber}`
    );
    return {
      collaterals: [],
      debts: [],
      totalCollateralUSD: 0,
      totalDebtUSD: 0,
      ltv: undefined,
      effectiveLiqLtv: undefined,
      eModeCategory: 0,
    };
  }

  const collaterals: ProcessedCollateral[] = [];
  const debts: ProcessedDebt[] = [];
  let totalCollateralUSD = 0;
  let totalDebtUSD = 0;
  let totalCollateralUSDForLTV = 0;
  let weightedLiquidationThreshold = 0;  // For calculating effective liquidation LTV

  let collateralIndex = 0;
  let debtIndex = 0;

  // Process each reserve
  for (const reserve of positionData.userReserves) {
    const assetAddress = reserve.underlyingAsset;
    
    // Fetch token metadata
    let tokenMetadata;
    try {
      tokenMetadata = await context.effect(getTokenDetails, {
        tokenAddress: assetAddress,
        chainId,
      });
    } catch (error) {
      context.log.error(`Failed to fetch token metadata for ${assetAddress}`, {
        error,
        chainId,
      });
      continue;
    }

    // Process collateral (if scaledATokenBalance > 0)
    if (reserve.scaledATokenBalance > 0n) {
      let collateralPriceUSD: number | undefined;
      try {
        const price = await context.effect(getAssetPrice, {
          assetAddress,
          chainId,
          blockNumber: priceBlockNumber,
        });

        // Convert scaled balance to USD
        const amountInTokens = Number(reserve.scaledATokenBalance) / (10 ** tokenMetadata.decimals);
        const priceInUSD = Number(price.price) / (10 ** 8);
        collateralPriceUSD = amountInTokens * priceInUSD;

        totalCollateralUSD += collateralPriceUSD;

        // Only count for LTV if enabled as collateral
        if (reserve.usageAsCollateralEnabledOnUser) {
          totalCollateralUSDForLTV += collateralPriceUSD;

          // Accumulate weighted liquidation threshold (using EMode-adjusted value)
          const liqThreshold = Number(reserve.liquidationThreshold) / 1e4;
          weightedLiquidationThreshold += collateralPriceUSD * liqThreshold;
        }
      } catch (error) {
        context.log.warn(`Failed to fetch price for collateral ${assetAddress}`, {
          error,
          chainId,
        });
      }

      const collateral: ProcessedCollateral = {
        id: `${snapshotId}_col_${collateralIndex}`,
        asset: assetAddress,
        symbol: tokenMetadata.symbol,
        decimals: tokenMetadata.decimals,
        amount: reserve.scaledATokenBalance,
        amountUSD: collateralPriceUSD,
        enabledAsCollateral: reserve.usageAsCollateralEnabledOnUser,
        isSeized: assetAddress.toLowerCase() === seizedAsset.toLowerCase(),
      };
      
      collaterals.push(collateral);
      collateralIndex++;
    }

    // Process debt (if currentVariableDebt > 0)
    // Use currentVariableDebt (actual debt with accrued interest) instead of scaledVariableDebt
    if (reserve.currentVariableDebt > 0n) {
      let debtPriceUSD: number | undefined;
      try {
        const price = await context.effect(getAssetPrice, {
          assetAddress,
          chainId,
          blockNumber: priceBlockNumber,
        });

        // Convert current debt balance to USD (includes accrued interest)
        const amountInTokens = Number(reserve.currentVariableDebt) / (10 ** tokenMetadata.decimals);
        const priceInUSD = Number(price.price) / (10 ** 8);
        debtPriceUSD = amountInTokens * priceInUSD;

        totalDebtUSD += debtPriceUSD;
      } catch (error) {
        context.log.warn(`Failed to fetch price for debt ${assetAddress}`, {
          error,
          chainId,
        });
      }

      const debt: ProcessedDebt = {
        id: `${snapshotId}_debt_${debtIndex}`,
        asset: assetAddress,
        symbol: tokenMetadata.symbol,
        decimals: tokenMetadata.decimals,
        amount: reserve.currentVariableDebt,  // Store actual debt with interest
        amountUSD: debtPriceUSD,
        isRepaid: assetAddress.toLowerCase() === repaidAsset.toLowerCase(),
      };

      debts.push(debt);
      debtIndex++;
    }
  }

  // Calculate LTV: totalDebtUSD / sum(collateralUSD where enabledAsCollateral=true)
  const ltv = totalCollateralUSDForLTV > 0
    ? totalDebtUSD / totalCollateralUSDForLTV
    : undefined;

  // Calculate effective liquidation LTV (weighted average of liquidation thresholds)
  const effectiveLiqLtv = totalCollateralUSDForLTV > 0
    ? weightedLiquidationThreshold / totalCollateralUSDForLTV
    : undefined;

  return {
    collaterals,
    debts,
    totalCollateralUSD,
    totalDebtUSD,
    ltv,
    effectiveLiqLtv,
    eModeCategory: positionData.eModeCategory,
  };
}

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

// Helper function to process Euler position snapshots
export async function processEulerPositionSnapshot(
  context: any,
  userAddress: string,
  chainId: number,
  blockNumber: bigint,
  priceBlockNumber: bigint,
  seizedVault: string,
  repaidVault: string,
  snapshotId: string
): Promise<PositionSnapshotData> {
  // Fetch user position data from AccountLens at blockNumber (N-1, pre-liquidation state)
  const positionData = await context.effect(getEulerUserPositionData, {
    userAddress,
    chainId,
    blockNumber,
  });

  if (positionData.vaultAccountInfos.length === 0) {
    context.log.warn(
      `No position data found for user ${userAddress} on chain ${chainId} at block ${blockNumber}`
    );
    return {
      collaterals: [],
      debts: [],
      totalCollateralUSD: 0,
      totalDebtUSD: 0,
      ltv: undefined,
      effectiveLiqLtv: undefined,
      eModeCategory: 0,
    };
  }

  const collaterals: ProcessedCollateral[] = [];
  const debts: ProcessedDebt[] = [];
  let totalCollateralUSD = 0;
  let totalDebtUSD = 0;
  let totalCollateralUSDForLTV = 0;

  const usdAddress = getEulerUSDAddress(chainId);

  let collateralIndex = 0;
  let debtIndex = 0;

  // Process each vault
  for (const vaultInfo of positionData.vaultAccountInfos) {
    const vaultAddress = vaultInfo.vault;
    const assetAddress = vaultInfo.asset;
    
    // Fetch token metadata (should already exist from vault creation)
    let tokenMetadata;
    try {
      tokenMetadata = await context.Token.get(`${chainId}_${assetAddress}`);
      if (!tokenMetadata) {
        // Fallback: fetch if not found
        tokenMetadata = await context.effect(getTokenDetails, {
          tokenAddress: assetAddress,
          chainId,
        });
      }
    } catch (error) {
      context.log.error(`Failed to fetch token metadata for ${assetAddress}`, {
        error,
        chainId,
      });
      continue;
    }

    // Process collateral (if assets > 0 and not a controller)
    if (vaultInfo.assets > 0n && !vaultInfo.isController) {
      let collateralPriceUSD: number | undefined;

      // Look up vault details to get the oracle, then quote to USD
      const collateralVaultDetails = await context.EVaultDetails.get(`${chainId}_${vaultAddress}`);
      if (collateralVaultDetails?.oracle) {
        try {
          const quoteResult = await context.effect(getQuote, {
            oracle: collateralVaultDetails.oracle,
            inAmount: vaultInfo.assets,
            base: assetAddress,
            quote: usdAddress,
            chainId,
            blockNumber: priceBlockNumber,
          });
          collateralPriceUSD = Number(quoteResult.price) / 1e18;
        } catch (error) {
          context.log.error(`Failed to get USD quote for collateral vault ${vaultAddress}`, {
            error,
            chainId,
          });
        }
      }

      if (collateralPriceUSD !== undefined) {
        totalCollateralUSD += collateralPriceUSD;
        
        // Only count for LTV if enabled as collateral
        if (vaultInfo.isCollateral) {
          totalCollateralUSDForLTV += collateralPriceUSD;
        }
      }

      const collateral: ProcessedCollateral = {
        id: `${snapshotId}_col_${collateralIndex}`,
        asset: assetAddress,
        symbol: tokenMetadata.symbol,
        decimals: tokenMetadata.decimals,
        amount: vaultInfo.assets,  // Use assets, not assetsAccount
        amountUSD: collateralPriceUSD,
        enabledAsCollateral: vaultInfo.isCollateral,
        isSeized: vaultAddress.toLowerCase() === seizedVault.toLowerCase(),
      };
      
      collaterals.push(collateral);
      collateralIndex++;
    }

    // Process debt (if borrowed > 0 and is a controller)
    if (vaultInfo.borrowed > 0n && vaultInfo.isController) {
      let debtPriceUSD: number | undefined;

      // Look up vault details to get the oracle, then quote to USD
      const debtVaultDetails = await context.EVaultDetails.get(`${chainId}_${vaultAddress}`);
      if (debtVaultDetails?.oracle) {
        try {
          const quoteResult = await context.effect(getQuote, {
            oracle: debtVaultDetails.oracle,
            inAmount: vaultInfo.borrowed,
            base: assetAddress,
            quote: usdAddress,
            chainId,
            blockNumber: priceBlockNumber,
          });
          debtPriceUSD = Number(quoteResult.price) / 1e18;
          totalDebtUSD += debtPriceUSD;
        } catch (error) {
          context.log.error(`Failed to get USD quote for debt vault ${vaultAddress}`, {
            error,
            chainId,
          });
        }
      }

      const debt: ProcessedDebt = {
        id: `${snapshotId}_debt_${debtIndex}`,
        asset: assetAddress,
        symbol: tokenMetadata.symbol,
        decimals: tokenMetadata.decimals,
        amount: vaultInfo.borrowed,
        amountUSD: debtPriceUSD,
        isRepaid: vaultAddress.toLowerCase() === repaidVault.toLowerCase(),
      };
      
      debts.push(debt);
      debtIndex++;
    }
  }

  // Calculate LTV: totalDebtUSD / sum(collateralUSD where enabledAsCollateral=true)
  const ltv = totalCollateralUSDForLTV > 0
    ? totalDebtUSD / totalCollateralUSDForLTV
    : undefined;

  return {
    collaterals,
    debts,
    totalCollateralUSD,
    totalDebtUSD,
    ltv,
    effectiveLiqLtv: undefined,  // Euler doesn't use EMode
    eModeCategory: 0,  // Euler doesn't use EMode
  };
}
