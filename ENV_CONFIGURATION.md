# Environment Configuration for RPC Rotation

## Quick Start

### RPC Endpoints (Rotation)

To configure multiple RPC endpoints for automatic rotation, use the following format in your `.env` file:

```env
RPC_URL_{chainId}=url1,url2,url3
```

## Example Configuration

```env
# ========================================
# RPC ENDPOINTS (Rotation)
# ========================================

# Ethereum Mainnet (Chain ID: 1)
RPC_URL_1=https://eth.drpc.org,https://rpc.ankr.com/eth,https://eth.llamarpc.com

# Optimism (Chain ID: 10)
RPC_URL_10=https://optimism.drpc.org,https://rpc.ankr.com/optimism

# Arbitrum (Chain ID: 42161)
RPC_URL_42161=https://arbitrum.drpc.org,https://rpc.ankr.com/arbitrum,https://arb1.arbitrum.io/rpc

# Polygon (Chain ID: 137)
RPC_URL_137=https://polygon.drpc.org,https://polygon-rpc.com

# Base (Chain ID: 8453)
RPC_URL_8453=https://base.drpc.org,https://mainnet.base.org

# Gnosis (Chain ID: 100)
RPC_URL_100=https://gnosis.drpc.org,https://rpc.gnosischain.com

# Linea (Chain ID: 59144)
RPC_URL_59144=https://linea.drpc.org,https://rpc.linea.build

# Scroll (Chain ID: 534352)
RPC_URL_534352=https://scroll.drpc.org,https://rpc.scroll.io

# Avalanche (Chain ID: 43114)
RPC_URL_43114=https://avalanche.drpc.org,https://api.avax.network/ext/bc/C/rpc

# BSC (Chain ID: 56)
RPC_URL_56=https://bsc.drpc.org,https://bsc-dataseed.binance.org
```

## Important Rules

1. **Use commas** to separate multiple RPCs (no spaces)
2. **Order matters** - first RPC is tried first
3. **No line breaks** in the middle of RPC lists
4. **Each chain** can have different number of RPCs

## How It Works

### RPC Rotation
When an RPC call fails:
1. System automatically tries the next RPC in the list
2. Each RPC is tried once per request
3. If all RPCs fail, a default value is returned with error logging

## Recommended Setup

### RPC Endpoints
- **Minimum**: 2 RPCs per chain (primary + backup)
- **Recommended**: 3 RPCs per chain (primary + 2 backups)
- **Mix providers** for better reliability

For more details, see `RPC_ROTATION_GUIDE.md`
