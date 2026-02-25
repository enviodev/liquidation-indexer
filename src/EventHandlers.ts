/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features.
 */
import {
  AaveProxy,
  AaveProxy_LiquidationCall,
  EulerFactory,
  EVaultDetails,
  EulerVaultProxy,
  EulerVaultProxy_Liquidate,
  Morpho,
  Morpho_Liquidate,
  GeneralizedLiquidation,
  LiquidationStats,
} from "generated";
import type { Morpho_CreateMarket as Morpho_CreateMarketEntity } from "generated/src/Types.gen";
import { updateLiquidatorData, updateBorrowerData, processAavePositionSnapshot, processEulerPositionSnapshot } from "./helpers";
import { getEVaultMetadata } from "./evaultMetadata";
import { getTokenDetails } from "./tokenDetails";
import { getQuote } from "./evaultOracle";
import { getAssetPrice } from "./aaveOracle";
import { getMorphoHistoricalPrice } from "./morphoOracle";
import { getAaveV3ReserveData } from "./aaveMetadata";
import { getEulerOracleAddress, getEulerUSDAddress } from "./utils";
import { getEulerVaultLtvInfo } from "./eulerVaultInfo";
import { getMorphoUserPositionData, getMorphoOraclePrice } from "./morphoPositionSnapshot";

AaveProxy.LiquidationCall.handler(async ({ event, context }) => {
  const entity: AaveProxy_LiquidationCall = {
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

  context.AaveProxy_LiquidationCall.set(entity);

  try {
    const collateralTokenMetadata = await context.effect(getTokenDetails, {
      tokenAddress: event.params.collateralAsset,
      chainId: event.chainId,
    });
    context.Token.set({
      id: `${event.chainId}_${event.params.collateralAsset}`,
      chainId: event.chainId,
      name: collateralTokenMetadata.name,
      symbol: collateralTokenMetadata.symbol,
      decimals: collateralTokenMetadata.decimals,
    });
  } catch (error) {
    context.log.error(
      `Failed to fetch collateral token metadata ${event.params.collateralAsset}`,
      {
        tokenAddress: event.params.collateralAsset,
        chainId: event.chainId,
        err: error,
      }
    );
    return;
  }

  try {
    const debtTokenMetadata = await context.effect(getTokenDetails, {
      tokenAddress: event.params.debtAsset,
      chainId: event.chainId,
    });
    context.Token.set({
      id: `${event.chainId}_${event.params.debtAsset}`,
      chainId: event.chainId,
      name: debtTokenMetadata.name,
      symbol: debtTokenMetadata.symbol,
      decimals: debtTokenMetadata.decimals,
    });
  } catch (error) {
    context.log.error(
      `Failed to fetch debt token metadata ${event.params.debtAsset}`,
      {
        tokenAddress: event.params.debtAsset,
        chainId: event.chainId,
        err: error,
      }
    );
    return;
  }

  const collateralToken = await context.Token.get(
    `${event.chainId}_${event.params.collateralAsset}`
  );
  if (!collateralToken) {
    context.log.error("Collateral token entity not preloaded", {
      tokenAddress: event.params.collateralAsset,
      chainId: event.chainId,
    });
    return;
  }

  const debtToken = await context.Token.get(
    `${event.chainId}_${event.params.debtAsset}`
  );
  if (!debtToken) {
    context.log.error("Debt token entity not preloaded", {
      tokenAddress: event.params.debtAsset,
      chainId: event.chainId,
    });
    return;
  }

  const collateralSymbol =
    collateralToken.symbol || event.params.collateralAsset;
  const debtSymbol = debtToken.symbol || event.params.debtAsset;

  let collateralMarketDetails: any;
  let debtMarketDetails: any;

  try {
    collateralMarketDetails = await context.effect(getAaveV3ReserveData, {
      tokenAddress: event.params.collateralAsset,
      chainId: event.chainId,
      blockNumber: BigInt(event.block.number),
    });
    if (collateralMarketDetails) {
      context.AaveV3ReserveConfigurationData.set({
        id: `${event.chainId}_${event.params.collateralAsset}`,
        chainId: event.chainId,
        decimals: collateralMarketDetails.decimals,
        liqLTV: collateralMarketDetails.liqLTV,
        cf: collateralMarketDetails.cf,
        liq_inc: collateralMarketDetails.liq_inc,
        reserve_factor: collateralMarketDetails.reserve_factor,
      });
    }
  } catch (error) {
    context.log.warn(
      `Failed to fetch Aave V3 reserve data for collateral ${event.params.collateralAsset} on chain ${event.chainId}, continuing without it`,
      {
        tokenAddress: event.params.collateralAsset,
        chainId: event.chainId,
        err: error,
      }
    );
    // Don't return here - we can still process the liquidation without the reserve data
  }

  try {
    debtMarketDetails = await context.effect(getAaveV3ReserveData, {
      tokenAddress: event.params.debtAsset,
      chainId: event.chainId,
      blockNumber: BigInt(event.block.number),
    });
    if (debtMarketDetails) {
      context.AaveV3ReserveConfigurationData.set({
        id: `${event.chainId}_${event.params.debtAsset}`,
        chainId: event.chainId,
        decimals: debtMarketDetails.decimals,
        liqLTV: debtMarketDetails.liqLTV,
        cf: debtMarketDetails.cf,
        liq_inc: debtMarketDetails.liq_inc,
        reserve_factor: debtMarketDetails.reserve_factor,
      });
    }
  } catch (error) {
    context.log.warn(
      `Failed to fetch Aave V3 reserve data for debt ${event.params.debtAsset} on chain ${event.chainId}, continuing without it`,
      {
        tokenAddress: event.params.debtAsset,
        chainId: event.chainId,
        err: error,
      }
    );
    // Don't return here - we can still process the liquidation without the reserve data
  }

  // Only fetch prices if we have oracle addresses from reserve data
  let collateralPrice = { price: 0n };
  let debtPrice = { price: 0n };

  try {
    collateralPrice = await context.effect(getAssetPrice, {
      assetAddress: event.params.collateralAsset,
      chainId: event.chainId,
      blockNumber: BigInt(event.block.number),
    });
  } catch (error) {
    context.log.warn(`Failed to fetch collateral price, using 0`, {
      tokenAddress: event.params.collateralAsset,
      err: error,
    });
  }

  try {
    debtPrice = await context.effect(getAssetPrice, {
      assetAddress: event.params.debtAsset,
      chainId: event.chainId,
      blockNumber: BigInt(event.block.number),
    });
  } catch (error) {
    context.log.warn(`Failed to fetch debt price, using 0`, {
      tokenAddress: event.params.debtAsset,
      err: error,
    });
  }

  const seizedAssetsUSD =
    (Number(event.params.liquidatedCollateralAmount) /
      10 ** collateralToken.decimals) *
    (Number(collateralPrice.price) / 10 ** 8);
  const repaidAssetsUSD =
    (Number(event.params.debtToCover) / 10 ** debtToken.decimals) *
    (Number(debtPrice.price) / 10 ** 8);

  // Update liquidator data first to get the liquidator ID
  const liquidatorId = await updateLiquidatorData(
    context,
    event.params.liquidator,
    event.chainId,
    "Aave",
    BigInt(event.block.timestamp)
  );

  // Update borrower data to get the borrower ID
  const borrowerId = await updateBorrowerData(
    context,
    event.params.user,
    event.chainId,
    "Aave",
    BigInt(event.block.timestamp)
  );

  const generalized: GeneralizedLiquidation = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.chainId,
    timestamp: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    protocol: "Aave",
    borrower_id: borrowerId,
    liquidator_id: liquidatorId,
    txHash: event.transaction.hash,
    collateralAsset: collateralSymbol,
    debtAsset: debtSymbol,
    repaidAssets: event.params.debtToCover,
    repaidAssetsUSD: repaidAssetsUSD,
    seizedAssets: event.params.liquidatedCollateralAmount,
    seizedAssetsUSD: seizedAssetsUSD,
    positionSnapshot_id: undefined,
    liqLtv: undefined,  // Will be set from snapshot data (EMode-adjusted)
    closingFactor: undefined,
    liqInc: collateralMarketDetails ? Number(collateralMarketDetails.liq_inc) / 1e4 - 1 : undefined,
    reserveFactor: collateralMarketDetails ? Number(collateralMarketDetails.reserve_factor) / 1e4 : undefined,
    eModeCategory: undefined,  // Will be set from snapshot data
  };

  // Create position snapshot
  const snapshotId = `${event.chainId}_${event.block.number}_${event.logIndex}_snapshot`;
  try {
    const snapshotData = await processAavePositionSnapshot(
      context,
      event.params.user,
      event.chainId,
      BigInt(event.block.number-1),
      event.params.collateralAsset,
      event.params.debtAsset,
      snapshotId
    );

    // Create PositionSnapshot entity
    const positionSnapshot = {
      id: snapshotId,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
      protocol: "Aave",
      borrower: event.params.user,
      txHash: event.transaction.hash,
      totalCollateralUSD: snapshotData.totalCollateralUSD,
      totalDebtUSD: snapshotData.totalDebtUSD,
      ltv: snapshotData.ltv,
      liquidation_id: generalized.id,
    };
    context.PositionSnapshot.set(positionSnapshot);
    // Create PositionCollateral entities
    for (const collateral of snapshotData.collaterals) {
      context.PositionCollateral.set({
        id: collateral.id,
        positionSnapshot_id: snapshotId,
        asset: collateral.asset,
        symbol: collateral.symbol,
        decimals: collateral.decimals,
        amount: collateral.amount,
        amountUSD: collateral.amountUSD,
        enabledAsCollateral: collateral.enabledAsCollateral,
        isSeized: collateral.isSeized,
      });
    }
    // Create PositionDebt entities
    for (const debt of snapshotData.debts) {
      context.PositionDebt.set({
        id: debt.id,
        positionSnapshot_id: snapshotId,
        asset: debt.asset,
        symbol: debt.symbol,
        decimals: debt.decimals,
        amount: debt.amount,
        amountUSD: debt.amountUSD,
        isRepaid: debt.isRepaid,
      });
    }
    // Link snapshot to liquidation
    context.GeneralizedLiquidation.set({
      ...generalized,
      positionSnapshot_id: snapshotId,
      liqLtv: snapshotData.effectiveLiqLtv,  // EMode-adjusted weighted average
      closingFactor: seizedAssetsUSD / snapshotData.totalDebtUSD,
      eModeCategory: snapshotData.eModeCategory,
    });
  } catch (error) {
    context.log.error(
      `Failed to create position snapshot for liquidation ${generalized.id}`,
      {
        error,
        userAddress: event.params.user,
        chainId: event.chainId,
        blockNumber: event.block.number,
      }
    );
    // Continue without snapshot - use fallback liquidation threshold from reserve data
    context.GeneralizedLiquidation.set({
      ...generalized,
      liqLtv: collateralMarketDetails ? Number(collateralMarketDetails.liqLTV) / 1e4 : undefined,  // Fallback to reserve LTV
      eModeCategory: 0,  // Unknown EMode category
    });
  }

  // Update per-chain stats
  const perChainStatsId = `stats_${event.chainId}`;
  const existingPerChain = await context.LiquidationStats.get(perChainStatsId);
  const perChain: LiquidationStats = {
    id: perChainStatsId,
    chainId: event.chainId,
    aaveCount: BigInt(existingPerChain?.aaveCount ?? 0n) + 1n,
    eulerCount: BigInt(existingPerChain?.eulerCount ?? 0n),
    morphoCount: BigInt(existingPerChain?.morphoCount ?? 0n),
    totalCount: BigInt(existingPerChain?.totalCount ?? 0n) + 1n,
  };
  context.LiquidationStats.set(perChain);

  // Update global stats
  const globalId = `stats_global`;
  const existingGlobal = await context.LiquidationStats.get(globalId);
  const global: LiquidationStats = {
    id: globalId,
    chainId: undefined,
    aaveCount: BigInt(existingGlobal?.aaveCount ?? 0n) + 1n,
    eulerCount: BigInt(existingGlobal?.eulerCount ?? 0n),
    morphoCount: BigInt(existingGlobal?.morphoCount ?? 0n),
    totalCount: BigInt(existingGlobal?.totalCount ?? 0n) + 1n,
  };
  context.LiquidationStats.set(global);
});

EulerFactory.ProxyCreated.handler(async ({ event, context }) => {
  try {
    const evaultMetadata = await context.effect(getEVaultMetadata, {
      vaultAddress: event.params.proxy,
      chainId: event.chainId,
      blockNumber: BigInt(event.block.number),
    });
    const entity: EVaultDetails = {
      id: `${event.chainId}_${event.params.proxy}`,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
      asset: evaultMetadata.asset,
      name: evaultMetadata.name,
      symbol: evaultMetadata.symbol,
      oracle: evaultMetadata.oracle,
      unitOfAccount: evaultMetadata.unitOfAccount,
      decimals: evaultMetadata.decimals,
    };
    context.EVaultDetails.set(entity);
    if (evaultMetadata.asset) {
      try {
        const tokenMetadata = await context.effect(getTokenDetails, {
          tokenAddress: evaultMetadata.asset,
          chainId: event.chainId,
        });
        context.Token.set({
          id: `${event.chainId}_${evaultMetadata.asset}`,
          chainId: event.chainId,
          name: tokenMetadata.name,
          symbol: tokenMetadata.symbol,
          decimals: tokenMetadata.decimals,
        });
      } catch (error) {
        context.log.error(
          `Failed to fetch Euler token metadata ${evaultMetadata.asset}`,
          {
            tokenAddress: evaultMetadata.asset,
            chainId: event.chainId,
            err: error,
          }
        );
        return;
      }
    } else {
      context.log.error(
        `Failed to fetch EVault asset metadata ${event.params.proxy}`,
        {
          vaultAddress: event.params.proxy,
          chainId: event.chainId,
        }
      );
    }
  } catch (error) {
    context.log.error(
      `Failed to fetch EVault asset metadata ${event.params.proxy}`,
      {
        vaultAddress: event.params.proxy,
        chainId: event.chainId,
        err: error,
      }
    );
    return;
  }
});

EulerFactory.ProxyCreated.contractRegister(async ({ event, context }) => {
  context.addEulerVaultProxy(event.params.proxy);
});

EulerVaultProxy.Liquidate.handler(async ({ event, context }) => {
  const entity: EulerVaultProxy_Liquidate = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.chainId,
    timestamp: BigInt(event.block.timestamp),
    liquidator: event.params.liquidator,
    violator: event.params.violator,
    collateral: event.params.collateral,
    repayAssets: event.params.repayAssets,
    yieldBalance: event.params.yieldBalance,
  };

  context.EulerVaultProxy_Liquidate.set(entity);

  const usdAddress = getEulerUSDAddress(event.chainId);
  // const eulerOracleAddress = getEulerOracleAddress(event.chainId);

  const collateralVault = await context.EVaultDetails.get(
    `${event.chainId}_${event.params.collateral}`
  );
  if (!collateralVault?.asset) {
    context.log.error("Missing collateral vault metadata", {
      collateralVault: event.params.collateral,
      chainId: event.chainId,
    });
    return;
  }

  const debtVault = await context.EVaultDetails.get(
    `${event.chainId}_${event.srcAddress}`
  );
  if (!debtVault?.asset) {
    context.log.error("Missing debt vault metadata", {
      vaultAddress: event.srcAddress,
      chainId: event.chainId,
    });
    return;
  }
  const yieldBalanceUSD = await context.effect(getQuote, {
    oracle: collateralVault.oracle,
    inAmount: BigInt(event.params.yieldBalance),
    base: collateralVault.asset,
    quote: usdAddress,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
  });

  const repayAssetsUSD = await context.effect(getQuote, {
    oracle: debtVault.oracle,
    inAmount: BigInt(event.params.repayAssets),
    base: debtVault.asset,
    quote: usdAddress,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
  });

  const collateralToken = await context.Token.get(
    `${event.chainId}_${collateralVault.asset}`
  );
  if (!collateralToken) {
    context.log.error("Collateral token not loaded", {
      tokenAddress: collateralVault.asset,
      chainId: event.chainId,
    });
    return;
  }

  const debtToken = await context.Token.get(
    `${event.chainId}_${debtVault.asset}`
  );
  if (!debtToken) {
    context.log.error("Debt token not loaded", {
      tokenAddress: debtVault.asset,
      chainId: event.chainId,
    });
    return;
  }

  const collateralSymbol = collateralToken.symbol || collateralVault.asset;
  const debtSymbol = debtToken.symbol || debtVault.asset;

  // Update liquidator data first to get the liquidator ID
  const liquidatorId = await updateLiquidatorData(
    context,
    event.params.liquidator,
    event.chainId,
    "Euler",
    BigInt(event.block.timestamp)
  );

  // Update borrower data to get the borrower ID
  const borrowerId = await updateBorrowerData(
    context,
    event.params.violator,
    event.chainId,
    "Euler",
    BigInt(event.block.timestamp)
  );

  // Fetch vault LTV info before creating snapshot
  let ltvInfo;
  try {
    ltvInfo = await context.effect(getEulerVaultLtvInfo, {
      debtVaultAddress: event.srcAddress,
      collateralVaultAddress: event.params.collateral,
      chainId: event.chainId,
      blockNumber: BigInt(event.block.number),
    });
  } catch (error) {
    context.log.warn(
      `Failed to fetch LTV info for Euler liquidation, using defaults`,
      {
        debtVault: event.srcAddress,
        collateralVault: event.params.collateral,
        chainId: event.chainId,
        error,
      }
    );
    // Use default values if LTV info fetch fails
    ltvInfo = {
      liquidationLTV: 0n,
      borrowLTV: 0n,
      initialLiquidationLTV: 0n,
      targetTimestamp: 0n,
      rampDuration: 0n,
    };
  }

  const generalized: GeneralizedLiquidation = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    blockNumber: BigInt(event.block.number),
    chainId: event.chainId,
    timestamp: BigInt(event.block.timestamp),
    protocol: "Euler",
    borrower_id: borrowerId,
    liquidator_id: liquidatorId,
    txHash: event.transaction.hash,
    collateralAsset: collateralSymbol,
    debtAsset: debtSymbol,
    repaidAssets: BigInt(event.params.repayAssets),
    repaidAssetsUSD: Number(repayAssetsUSD.price) / 1e18,
    seizedAssets: BigInt(event.params.yieldBalance),
    seizedAssetsUSD: Number(yieldBalanceUSD.price) / 1e18,
    positionSnapshot_id: undefined,
    liqLtv: Number(ltvInfo.liquidationLTV) / 1e4,
    closingFactor: undefined,
    liqInc: undefined,
    reserveFactor: 0,
    eModeCategory: undefined,  // EMode is Aave-specific
  };

  // Create position snapshot
  const snapshotId = `${event.chainId}_${event.block.number}_${event.logIndex}_snapshot`;

  try {
    const snapshotData = await processEulerPositionSnapshot(
      context,
      event.params.violator,
      event.chainId,
      BigInt(event.block.number-1),
      event.params.collateral,  // seized vault address
      event.srcAddress,          // repaid vault address (debt vault that emitted the event)
      snapshotId
    );

    // Create PositionSnapshot entity
    const positionSnapshot = {
      id: snapshotId,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
      protocol: "Euler",
      borrower: event.params.violator,
      txHash: event.transaction.hash,
      totalCollateralUSD: snapshotData.totalCollateralUSD,
      totalDebtUSD: snapshotData.totalDebtUSD,
      ltv: snapshotData.ltv,
      liquidation_id: generalized.id,
    };
    context.PositionSnapshot.set(positionSnapshot);

    // Create PositionCollateral entities
    for (const collateral of snapshotData.collaterals) {
      context.PositionCollateral.set({
        id: collateral.id,
        positionSnapshot_id: snapshotId,
        asset: collateral.asset,
        symbol: collateral.symbol,
        decimals: collateral.decimals,
        amount: collateral.amount,
        amountUSD: collateral.amountUSD,
        enabledAsCollateral: collateral.enabledAsCollateral,
        isSeized: collateral.isSeized,
      });
    }

    // Create PositionDebt entities
    for (const debt of snapshotData.debts) {
      context.PositionDebt.set({
        id: debt.id,
        positionSnapshot_id: snapshotId,
        asset: debt.asset,
        symbol: debt.symbol,
        decimals: debt.decimals,
        amount: debt.amount,
        amountUSD: debt.amountUSD,
        isRepaid: debt.isRepaid,
      });
    }

    // Link snapshot to liquidation with computed values
    context.GeneralizedLiquidation.set({
      ...generalized,
      positionSnapshot_id: snapshotId,
      closingFactor: (Number(repayAssetsUSD.price) / 1e18) / snapshotData.totalDebtUSD,
      liqInc: (Number(yieldBalanceUSD.price) / 1e18) / (Number(repayAssetsUSD.price) / 1e18) - 1,
    });

  } catch (error) {
    context.log.error(
      `Failed to create position snapshot for liquidation ${generalized.id}`,
      {
        error,
        userAddress: event.params.violator,
        chainId: event.chainId,
        blockNumber: event.block.number,
      }
    );
    // Persist liquidation without snapshot data (liqInc/closingFactor remain undefined)
    context.GeneralizedLiquidation.set(generalized);
  }

  // Update per-chain stats
  const perChainStatsId2 = `stats_${event.chainId}`;
  const existingPerChain2 = await context.LiquidationStats.get(
    perChainStatsId2
  );
  const perChain2: LiquidationStats = {
    id: perChainStatsId2,
    chainId: event.chainId,
    aaveCount: BigInt(existingPerChain2?.aaveCount ?? 0n),
    eulerCount: BigInt(existingPerChain2?.eulerCount ?? 0n) + 1n,
    morphoCount: BigInt(existingPerChain2?.morphoCount ?? 0n),
    totalCount: BigInt(existingPerChain2?.totalCount ?? 0n) + 1n,
  };
  context.LiquidationStats.set(perChain2);

  // Update global stats
  const globalId2 = `stats_global`;
  const existingGlobal2 = await context.LiquidationStats.get(globalId2);
  const global2: LiquidationStats = {
    id: globalId2,
    chainId: undefined,
    aaveCount: BigInt(existingGlobal2?.aaveCount ?? 0n),
    eulerCount: BigInt(existingGlobal2?.eulerCount ?? 0n) + 1n,
    morphoCount: BigInt(existingGlobal2?.morphoCount ?? 0n),
    totalCount: BigInt(existingGlobal2?.totalCount ?? 0n) + 1n,
  };
  context.LiquidationStats.set(global2);
});

Morpho.CreateMarket.handler(async ({ event, context }) => {
  const entity: Morpho_CreateMarketEntity = {
    id: `${event.chainId}_${event.params.id}`,
    chainId: event.chainId,
    timestamp: BigInt(event.block.timestamp),
    loanToken: event.params.marketParams[0],
    collateralToken: event.params.marketParams[1],
    oracle: event.params.marketParams[2],
    irm: event.params.marketParams[3],
    lltv: event.params.marketParams[4],
  };

  // Persist market entity before token fetches so it's available for future Liquidate events
  // even if token metadata fetches fail
  context.Morpho_CreateMarket.set(entity);

  try {
    const loanTokenMetadata = await context.effect(getTokenDetails, {
      tokenAddress: event.params.marketParams[0],
      chainId: event.chainId,
    });
    context.Token.set({
      id: `${event.chainId}_${event.params.marketParams[0]}`,
      chainId: event.chainId,
      name: loanTokenMetadata.name,
      symbol: loanTokenMetadata.symbol,
      decimals: loanTokenMetadata.decimals,
    });
  } catch (error) {
    context.log.error(
      `Failed to fetch loan token metadata ${event.params.marketParams[0]}`,
      {
        tokenAddress: event.params.marketParams[0],
        chainId: event.chainId,
        err: error,
      }
    );
    return;
  }

  try {
    const collateralTokenMetadata = await context.effect(getTokenDetails, {
      tokenAddress: event.params.marketParams[1],
      chainId: event.chainId,
    });
    context.Token.set({
      id: `${event.chainId}_${event.params.marketParams[1]}`,
      chainId: event.chainId,
      name: collateralTokenMetadata.name,
      symbol: collateralTokenMetadata.symbol,
      decimals: collateralTokenMetadata.decimals,
    });
  } catch (error) {
    context.log.error(
      `Failed to fetch collateral token metadata ${event.params.marketParams[1]}`,
      {
        tokenAddress: event.params.marketParams[1],
        chainId: event.chainId,
        err: error,
      }
    );
    return;
  }

});


Morpho.Liquidate.handler(async ({ event, context }) => {
  const entity: Morpho_Liquidate = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.chainId,
    timestamp: BigInt(event.block.timestamp),
    id_bytes32: event.params.id,
    caller: event.params.caller,
    borrower: event.params.borrower,
    repaidAssets: event.params.repaidAssets,
    repaidShares: event.params.repaidShares,
    seizedAssets: event.params.seizedAssets,
    badDebtAssets: event.params.badDebtAssets,
    badDebtShares: event.params.badDebtShares,
  };

  context.Morpho_Liquidate.set(entity);

  const market = await context.Morpho_CreateMarket.get(`${event.chainId}_${event.params.id}`);
  if (!market) {
    context.log.error("Market metadata missing for liquidation", {
      marketId: event.params.id,
      chainId: event.chainId,
    });
    return;
  }

  const collateralAsset = market.collateralToken;
  const debtAsset = market.loanToken;

  if (!collateralAsset || !debtAsset) {
    context.log.error("Market assets not set", {
      marketId: event.params.id,
      chainId: event.chainId,
      collateralAsset,
      debtAsset,
    });
    return;
  }

  const collateralToken = await context.Token.get(
    `${event.chainId}_${collateralAsset}`
  );
  if (!collateralToken) {
    context.log.error("Collateral token not loaded", {
      tokenAddress: collateralAsset,
      chainId: event.chainId,
    });
    return;
  }

  const debtToken = await context.Token.get(`${event.chainId}_${debtAsset}`);
  if (!debtToken) {
    context.log.error("Debt token not loaded", {
      tokenAddress: debtAsset,
      chainId: event.chainId,
    });
    return;
  }

  const collateralSymbol = collateralToken.symbol || collateralAsset;
  const debtSymbol = debtToken.symbol || debtAsset;

  const collateralDecimals = collateralToken.decimals || 18;
  const debtDecimals = debtToken.decimals || 18;

  // Fetch historical prices from Morpho API for USD calculations
  let collateralPrice = { price: 0 };
  let debtPrice = { price: 0 };

  try {
    collateralPrice = await context.effect(getMorphoHistoricalPrice, {
      assetAddress: collateralAsset,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
    });
  } catch (error) {
    context.log.warn(`Failed to fetch Morpho collateral price, using 0`, {
      tokenAddress: collateralAsset,
      chainId: event.chainId,
      err: error,
    });
  }

  try {
    debtPrice = await context.effect(getMorphoHistoricalPrice, {
      assetAddress: debtAsset,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
    });
  } catch (error) {
    context.log.warn(`Failed to fetch Morpho debt price, using 0`, {
      tokenAddress: debtAsset,
      chainId: event.chainId,
      err: error,
    });
  }

  const seizedAssetsUSD =
    (Number(event.params.seizedAssets) / 10 ** collateralDecimals) *
    Number(collateralPrice.price);
  const repaidAssetsUSD =
    (Number(event.params.repaidAssets) / 10 ** debtDecimals) *
    Number(debtPrice.price);

  // Update liquidator data first to get the liquidator ID
  const liquidatorId = await updateLiquidatorData(
    context,
    event.params.caller,
    event.chainId,
    "Morpho",
    BigInt(event.block.timestamp)
  );

  // Update borrower data to get the borrower ID
  const borrowerId = await updateBorrowerData(
    context,
    event.params.borrower,
    event.chainId,
    "Morpho",
    BigInt(event.block.timestamp)
  );

  let preLiqCollateralAmount = 0n;
  let preLiqBorrowAmount = 0n;
  let preLiqSupplyShares = 0n;

  try {const positionData = await context.effect(getMorphoUserPositionData, {
    userAddress: event.params.borrower,
    marketId: event.params.id,
    morphoAddress: event.srcAddress,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number-1),
  });
  preLiqCollateralAmount = positionData.collateralAmount;
  preLiqBorrowAmount = positionData.borrowAmount;
  preLiqSupplyShares = positionData.supplyShares;

  } catch (error) {
    context.log.error(`Failed to fetch Morpho user position data`, {
      error,
      borrower: event.params.borrower,
      marketId: event.params.id,
      chainId: event.chainId,
    });
  }

  let oraclePrice = { price: 0n };
  try {oraclePrice = await context.effect(getMorphoOraclePrice, {
    oracleAddress: market.oracle,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number-1),
  });
  } catch (error) {
    context.log.error(`Failed to fetch Morpho oracle price`, {
    error,
    oracleAddress: market.oracle,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number-1),
  });
  }

  // Compute LTV and USD values, guarding against zero/missing data
  let ltv: number | undefined = undefined;
  if (preLiqCollateralAmount > 0n && oraclePrice.price > 0n) {
    const collateralValueInLoanTokens = (preLiqCollateralAmount * oraclePrice.price) / (10n ** 36n);
    if (collateralValueInLoanTokens > 0n) {
      ltv = Number(preLiqBorrowAmount) / Number(collateralValueInLoanTokens);
    }
  }

  const totalCollateralUSD = (Number(preLiqCollateralAmount) / 10 ** collateralDecimals) * Number(collateralPrice.price);
  const totalDebtUSD = (Number(preLiqBorrowAmount) / 10 ** debtDecimals) * Number(debtPrice.price);

  const LIQUIDATION_CURSOR = 0.3;
  const MAX_LIQUIDATION_INCENTIVE_FACTOR = 1.15;
  const WAD = 1;
  const scaledLiqLtv = Number(market.lltv) / 1e18;
  const liqInc = Math.min(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
      WAD / (WAD - LIQUIDATION_CURSOR * (WAD - scaledLiqLtv))
  ) - 1;

  let closingFactor: number | undefined = undefined;
  if (totalDebtUSD > 0 && repaidAssetsUSD > 0) {
    closingFactor = repaidAssetsUSD / totalDebtUSD;
  } else if (preLiqBorrowAmount > 0n) {
    closingFactor = Number(event.params.repaidAssets) / Number(preLiqBorrowAmount);
  }

  // Process position snapshot - only create if we have valid position data
  const snapshotId = `${event.chainId}_${event.block.number}_${event.logIndex}_snapshot`;
  const liquidationId = `${event.chainId}_${event.block.number}_${event.logIndex}`;

  if (preLiqCollateralAmount > 0n || preLiqBorrowAmount > 0n) {
    context.PositionSnapshot.set({
      id: snapshotId,
      chainId: event.chainId,
      timestamp: BigInt(event.block.timestamp),
      borrower: event.params.borrower,
      protocol: "Morpho",
      txHash: event.transaction.hash,
      liquidation_id: liquidationId,
      totalCollateralUSD: totalCollateralUSD,
      totalDebtUSD: totalDebtUSD,
      ltv: ltv,
    });

    context.PositionCollateral.set({
      id: `${snapshotId}_col_0`,
      positionSnapshot_id: snapshotId,
      asset: collateralAsset,
      symbol: collateralSymbol,
      decimals: collateralDecimals,
      amount: preLiqCollateralAmount,
      amountUSD: totalCollateralUSD,
      enabledAsCollateral: true,
      isSeized: true,
    });

    context.PositionDebt.set({
      id: `${snapshotId}_debt_0`,
      positionSnapshot_id: snapshotId,
      asset: debtAsset,
      symbol: debtSymbol,
      decimals: debtDecimals,
      amount: preLiqBorrowAmount,
      amountUSD: totalDebtUSD,
      isRepaid: false,
    });
  }

  const generalized: GeneralizedLiquidation = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    blockNumber: BigInt(event.block.number),
    chainId: event.chainId,
    timestamp: BigInt(event.block.timestamp),
    protocol: "Morpho",
    borrower_id: borrowerId,
    liquidator_id: liquidatorId,
    txHash: event.transaction.hash,
    collateralAsset: collateralSymbol,
    debtAsset: debtSymbol,
    repaidAssets: event.params.repaidAssets,
    repaidAssetsUSD: repaidAssetsUSD,
    seizedAssets: event.params.seizedAssets,
    seizedAssetsUSD: seizedAssetsUSD,
    positionSnapshot_id: (preLiqCollateralAmount > 0n || preLiqBorrowAmount > 0n) ? snapshotId : undefined,
    liqLtv: scaledLiqLtv,
    closingFactor: closingFactor,
    liqInc: liqInc,
    reserveFactor: 0,
    eModeCategory: undefined,  // EMode is Aave-specific
  };
  context.GeneralizedLiquidation.set(generalized);

  // Update per-chain stats
  const perChainStatsId3 = `stats_${event.chainId}`;
  const existingPerChain3 = await context.LiquidationStats.get(
    perChainStatsId3
  );
  const perChain3: LiquidationStats = {
    id: perChainStatsId3,
    chainId: event.chainId,
    aaveCount: BigInt(existingPerChain3?.aaveCount ?? 0n),
    eulerCount: BigInt(existingPerChain3?.eulerCount ?? 0n),
    morphoCount: BigInt(existingPerChain3?.morphoCount ?? 0n) + 1n,
    totalCount: BigInt(existingPerChain3?.totalCount ?? 0n) + 1n,
  };
  context.LiquidationStats.set(perChain3);

  // Update global stats
  const globalId3 = `stats_global`;
  const existingGlobal3 = await context.LiquidationStats.get(globalId3);
  const global3: LiquidationStats = {
    id: globalId3,
    chainId: undefined,
    aaveCount: BigInt(existingGlobal3?.aaveCount ?? 0n),
    eulerCount: BigInt(existingGlobal3?.eulerCount ?? 0n),
    morphoCount: BigInt(existingGlobal3?.morphoCount ?? 0n) + 1n,
    totalCount: BigInt(existingGlobal3?.totalCount ?? 0n) + 1n,
  };
  context.LiquidationStats.set(global3);
});