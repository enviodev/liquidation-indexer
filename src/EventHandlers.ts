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
import { updateLiquidatorData, updateBorrowerData } from "./helpers";
import { getEVaultMetadata } from "./evaultMetadata";
import { getTokenDetails } from "./tokenDetails";
import { getQuote } from "./evaultOracle";
import { getAssetPrice } from "./aaveOracle";
import { getMorphoHistoricalPrice } from "./morphoOracle";
import { getAaveV3ReserveData } from "./aaveMetadata";

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
        ltv: collateralMarketDetails.ltv,
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
        ltv: debtMarketDetails.ltv,
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
  };
  context.GeneralizedLiquidation.set(generalized);

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
    quote: collateralVault.unitOfAccount,
    chainId: event.chainId,
    blockNumber: BigInt(event.block.number),
  });

  const repayAssetsUSD = await context.effect(getQuote, {
    oracle: debtVault.oracle,
    inAmount: BigInt(event.params.repayAssets),
    base: debtVault.asset,
    quote: debtVault.unitOfAccount,
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

  const generalized: GeneralizedLiquidation = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
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
  };
  context.GeneralizedLiquidation.set(generalized);

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

  context.Morpho_CreateMarket.set(entity);
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

  const generalized: GeneralizedLiquidation = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
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
