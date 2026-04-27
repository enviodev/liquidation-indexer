# Liquidation Indexer

A multi-protocol, multichain liquidation indexer built with [Envio HyperIndex](https://docs.envio.dev). Tracks liquidation events from Aave V3, Euler, and Morpho across 10 chains and exposes them through a unified GraphQL API.

## Chains (10)

`1`, `10`, `56`, `100`, `137`, `8453`, `42161`, `43114`, `59144`, `534352`

## What it indexes

- **Aave V3** (`AaveProxy.LiquidationCall`): collateral asset, debt asset, user, debt covered, liquidated collateral, liquidator
- **Euler** (`EulerFactory.ProxyCreated` plus `EulerVaultProxy.Liquidate`): factory-created vault proxies and per-vault liquidation events (liquidator, violator, collateral, repay assets, yield balance)
- **Morpho** (`Morpho.CreateMarket` plus `Morpho.Liquidate`): market creation and liquidation events with repaid/seized assets and bad debt accounting

A `GeneralizedLiquidation` entity normalises liquidations across all three protocols for unified queries.

## Schema

14 GraphQL entities including:

- `GeneralizedLiquidation`, `LiquidationStats`, `Liquidator`, `Borrower`
- `Token`, `PositionSnapshot`, `PositionCollateral`, `PositionDebt`
- Per-protocol entities: `AaveProxy_LiquidationCall`, `EVaultDetails`, `EulerVaultProxy_Liquidate`, `Morpho_CreateMarket`, `Morpho_Liquidate`
- `AaveV3ReserveConfigurationData`

## Run locally

```bash
pnpm install
pnpm dev
```

GraphQL playground at [http://localhost:8080](http://localhost:8080) (local password: `testing`).

## Generate from `config.yaml` or `schema.graphql`

```bash
pnpm codegen
```

## Pre-requisites

- [Node.js (use v18 or newer)](https://nodejs.org/en/download/current)
- [pnpm](https://pnpm.io/installation)
- [Docker](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/)

## Resources

- [Envio docs](https://docs.envio.dev)
- [HyperIndex overview](https://docs.envio.dev/docs/HyperIndex/overview)
- [Discord](https://discord.gg/envio)
