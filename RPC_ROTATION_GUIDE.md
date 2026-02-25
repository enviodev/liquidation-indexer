# RPC Rotation Implementation Guide

## Overview

This implementation provides automatic RPC endpoint rotation for the liquidation indexer. When an RPC request fails, the system automatically tries the next available RPC endpoint for that chain, cycling through all available endpoints before giving up.

## Features

- **Automatic Rotation**: If an RPC call fails, the system automatically tries the next RPC in the list
- **Bounded Retries**: Each unique RPC endpoint is tried once per request (no infinite loops)
- **Per-Chain Configuration**: Each chain can have its own set of RPC endpoints
- **Failure Tracking**: The system tracks which RPCs have failed and rotates through them
- **Detailed Logging**: All failures and rotations are logged for debugging

## Environment Variable Configuration

### Format

Store multiple RPC URLs for each chain as **comma-separated values**:

```env
RPC_URL_{chainId}=url1,url2,url3
```

### Examples

```env
# Ethereum Mainnet (Chain ID 1) - 3 RPCs
RPC_URL_1=https://eth.drpc.org,https://rpc.ankr.com/eth,https://eth.llamarpc.com

# Optimism (Chain ID 10) - 2 RPCs
RPC_URL_10=https://optimism.drpc.org,https://rpc.ankr.com/optimism

# Arbitrum (Chain ID 42161) - 4 RPCs
RPC_URL_42161=https://arbitrum.drpc.org,https://rpc.ankr.com/arbitrum,https://arb1.arbitrum.io/rpc,https://arbitrum-one.publicnode.com

# Polygon (Chain ID 137) - 2 RPCs
RPC_URL_137=https://polygon.drpc.org,https://polygon-rpc.com

# Base (Chain ID 8453) - 2 RPCs
RPC_URL_8453=https://base.drpc.org,https://mainnet.base.org

# Gnosis (Chain ID 100) - 2 RPCs
RPC_URL_100=https://gnosis.drpc.org,https://rpc.gnosischain.com

# Linea (Chain ID 59144) - 2 RPCs
RPC_URL_59144=https://linea.drpc.org,https://rpc.linea.build

# Scroll (Chain ID 534352) - 2 RPCs
RPC_URL_534352=https://scroll.drpc.org,https://rpc.scroll.io

# Avalanche (Chain ID 43114) - 2 RPCs
RPC_URL_43114=https://avalanche.drpc.org,https://api.avax.network/ext/bc/C/rpc

# BSC (Chain ID 56) - 2 RPCs
RPC_URL_56=https://bsc.drpc.org,https://bsc-dataseed.binance.org
```

### Important Notes

1. **No Spaces**: Do not add spaces around commas (unless they're part of the URL)
   - ✅ Good: `url1,url2,url3`
   - ❌ Bad: `url1, url2, url3`

2. **URL Validation**: Ensure all URLs are valid and accessible
   - URLs will be automatically trimmed of whitespace
   - Empty URLs will be ignored

3. **Fallback Behavior**: If no RPCs are configured for a chain, the system falls back to:
   - Built-in default RPCs for that chain
   - The generic `RPC_URL` environment variable (if set)
   - Final fallback: `https://eth.drpc.org`

## How It Works

### RPC Rotation Flow

1. **Initial Request**: System tries the first RPC in the list
2. **On Failure**: If the request fails:
   - Error is logged with details
   - System rotates to the next RPC in the list
   - Request is retried with the new RPC
3. **Bounded Retries**: System tries each RPC once (no infinite loops)
4. **All Failed**: If all RPCs fail, the operation returns a default value and logs the error

### Example Scenario

```
Chain: Ethereum (1)
RPCs: [A, B, C]

Request 1:
- Try RPC A → Success ✓
- Result returned

Request 2:
- Try RPC A → Fail ✗
- Rotate to RPC B
- Try RPC B → Fail ✗
- Rotate to RPC C
- Try RPC C → Success ✓
- Result returned

Request 3:
- Try RPC C (still current) → Success ✓
- Result returned
```

## Implementation Details

### Files Modified

1. **`src/rpcManager.ts`** (NEW)
   - Core RPC rotation logic
   - `RPCManager` class for managing RPC endpoints
   - `executeWithRPCRotation()` function for automatic retry

2. **`src/utils.ts`**
   - Re-exports RPC manager functions
   - Maintains backward compatibility

3. **`src/evaultOracle.ts`**
   - Updated to use `executeWithRPCRotation()`

4. **`src/evaultMetadata.ts`**
   - Updated to use `executeWithRPCRotation()`

5. **`src/aaveOracle.ts`**
   - Updated to use `executeWithRPCRotation()`

6. **`src/aaveMetadata.ts`**
   - Updated to use `executeWithRPCRotation()`
   - Supports both primary and fallback methods with rotation

7. **`src/tokenDetails.ts`**
   - Updated to use `executeWithRPCRotation()`
   - Supports both standard and bytes32 ERC20 methods with rotation

### API Usage

```typescript
import { executeWithRPCRotation } from './utils';

// Execute an RPC call with automatic rotation
const result = await executeWithRPCRotation(
  chainId,
  async (client) => {
    // Your RPC call here
    return await client.multicall({
      allowFailure: false,
      contracts: [/* ... */],
    });
  },
  {
    enableBatch: true,        // Enable batching (default: true)
    enableMulticall: true,    // Enable multicall (default: true)
  }
);
```

## Testing Your Configuration

To test your RPC configuration:

1. Set up your `.env` file with multiple RPCs per chain
2. Run the indexer
3. Monitor logs for RPC rotation messages:
   - `RPC call failed for chain X using Y. Attempt N/M. Error: ...`
   - `Rotating to next RPC: Z`
   - `All RPC endpoints failed for chain X. Tried N endpoints: ...`

## Recommended RPC Providers

Here are some reliable RPC providers to consider:

### Free Public RPCs
- **drpc.org** - Multi-chain support
- **Ankr** - Wide chain coverage
- **LlamaRPC** - Fast and reliable
- **Public Node** - Community-run nodes
- **Official Chain RPCs** - Chain-specific endpoints

### Paid/Private RPCs (for production)
- **Alchemy** - Enterprise-grade
- **Infura** - Reliable and fast
- **QuickNode** - Low latency
- **GetBlock** - Multi-chain support

## Best Practices

1. **Mix Providers**: Use RPCs from different providers to avoid correlated failures
   ```env
   RPC_URL_1=https://eth.drpc.org,https://rpc.ankr.com/eth,https://eth.llamarpc.com
   ```

2. **Order by Reliability**: Put your most reliable RPCs first
   ```env
   RPC_URL_1=https://your-paid-rpc.com,https://backup-rpc.com,https://free-public-rpc.org
   ```

3. **Monitor Logs**: Watch for frequent rotations, which indicate:
   - Unreliable RPCs (remove or reorder them)
   - Rate limiting (add more RPCs)
   - Network issues (check connectivity)

4. **Use Private RPCs for Production**: Public RPCs have rate limits and may be unreliable

5. **Keep 2-3 RPCs per Chain**: Balance between reliability and complexity
   - Minimum: 2 RPCs (primary + backup)
   - Recommended: 3 RPCs (primary + 2 backups)
   - Maximum: No hard limit, but 4-5 is usually sufficient

## Troubleshooting

### Problem: All RPCs are failing for a chain

**Possible Causes:**
- Network connectivity issues
- All RPCs are rate-limited
- Chain is experiencing downtime
- Incorrect RPC URLs

**Solutions:**
1. Check your internet connection
2. Verify RPC URLs are correct
3. Add more RPCs from different providers
4. Check if the chain is experiencing issues

### Problem: Frequent RPC rotations

**Possible Causes:**
- Rate limiting on free RPCs
- Weak/unreliable RPC endpoints
- Heavy indexer load

**Solutions:**
1. Upgrade to paid/private RPCs
2. Add more RPC endpoints
3. Reorder RPCs (most reliable first)

### Problem: Some chains work, others don't

**Possible Causes:**
- Missing RPC configuration for specific chains
- Chain-specific RPC issues

**Solutions:**
1. Verify `.env` file has RPCs for all chains
2. Test each RPC individually
3. Check chain-specific status pages

## Future Enhancements

Potential improvements to consider:

1. **Health Checking**: Periodically check RPC health and skip unhealthy ones
2. **Response Time Tracking**: Automatically prefer faster RPCs
3. **Weighted Selection**: Give preference to more reliable RPCs
4. **Circuit Breaker**: Temporarily disable consistently failing RPCs
5. **Metrics Dashboard**: Track RPC performance and failures

## Support

If you encounter issues:

1. Check the logs for error messages
2. Verify your `.env` configuration
3. Test RPCs individually
4. Review this guide
5. Open an issue with detailed logs

---

**Implementation Date**: 2025-10-08
**Version**: 1.0.0
**Status**: Production Ready
