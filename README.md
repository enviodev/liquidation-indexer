# Liquidation Indexer

Envio HyperIndex indexer covering 4 contracts across 10 chains.

## Chains

| Network | Chain ID |
|---|---|
| Ethereum Mainnet | 1 |
| Optimism | 10 |
| Arbitrum | 42161 |
| Polygon | 137 |
| Base | 8453 |
| Gnosis | 100 |
| Linea | 59144 |
| Scroll | 534352 |
| Avalanche | 43114 |
| Bsc | 56 |

## Contracts

- **`AaveProxy`**: `LiquidationCall`
- **`EulerFactory`**: `ProxyCreated`
- **`EulerVaultProxy`**: `Liquidate`
- **`Morpho`**: `CreateMarket`, `Liquidate`

## Schema entities (14)

`AaveProxy_LiquidationCall`, `EVaultDetails`, `EulerVaultProxy_Liquidate`, `Morpho_CreateMarket`, `Morpho_Liquidate`, `GeneralizedLiquidation`, `LiquidationStats`, `Liquidator`, `Borrower`, `Token`, `AaveV3ReserveConfigurationData`, `PositionSnapshot`, `PositionCollateral`, `PositionDebt`

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

- [Node.js v22+ (v24 recommended)](https://nodejs.org/en/download/current)
- [pnpm](https://pnpm.io/installation)
- [Docker](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/)

## Resources

- [Envio docs](https://docs.envio.dev)
- [HyperIndex overview](https://docs.envio.dev/docs/HyperIndex/overview)
- [Discord](https://discord.gg/envio)
