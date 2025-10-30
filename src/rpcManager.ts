import { createPublicClient, http, PublicClient } from "viem";
import { getChain } from "./utils";
import { rpcThrottleManager } from "./rpcThrottler";
import { TokenBucket, TokenBucketFactory } from "./tokenBucket";

/**
 * RPC Manager for handling multiple RPC endpoints per chain with automatic rotation.
 * 
 * Features:
 * - Parses comma-separated RPC URLs from environment variables
 * - Automatically rotates to next RPC on failure
 * - Per-RPC rate limiting with token buckets
 * - Proactive rotation based on rate limit saturation
 * - Request tracking per RPC endpoint
 * - Bounded retry mechanism (tries all available RPCs once)
 * - Thread-safe RPC index tracking per chain
 */

interface RPCEndpoint {
  url: string;
  failures: number;
  totalRequests: number;
  successfulRequests: number;
  tokenBucket: TokenBucket;
  lastUsed: number; // timestamp in ms
}

interface ChainRPCConfig {
  endpoints: RPCEndpoint[];
  currentIndex: number;
}

class RPCManager {
  private chainConfigs: Map<number, ChainRPCConfig>;
  private defaultRPCs: Record<number, string[]>;

  constructor() {
    this.chainConfigs = new Map();
    
    // Default fallback RPCs for each chain
    this.defaultRPCs = {
      1: ["https://eth.drpc.org"],
      10: ["https://optimism.drpc.org"],
      42161: ["https://arbitrum.drpc.org"],
      137: ["https://polygon.drpc.org"],
      8453: ["https://base.drpc.org"],
      100: ["https://gnosis.drpc.org"],
      59144: ["https://linea.drpc.org"],
      534352: ["https://scroll.drpc.org"],
      43114: ["https://avalanche.drpc.org"],
      56: ["https://bsc.drpc.org"],
    };
  }

  /**
   * Parse comma-separated RPC URLs from environment variable.
   * Returns array of URLs with whitespace trimmed.
   */
  private parseRPCUrls(envValue: string | undefined): string[] {
    if (!envValue || envValue.trim() === "") {
      return [];
    }
    
    const urls = envValue.split(",").map(url => url.trim());
    const validUrls = urls.filter(url => url.length > 0);
    
    return validUrls;
  }

  /**
   * Get RPC URLs for a specific chain from environment variables.
   * Falls back to default RPCs if no env var is set.
   */
  private getRPCUrlsForChain(chainId: number): string[] {
    const envKey = `RPC_URL_${chainId}`;
    const envValue = process.env[envKey];
    
    const parsedUrls = this.parseRPCUrls(envValue);
    
    if (parsedUrls.length > 0) {
      return parsedUrls;
    }
    
    // Fallback to default RPCs
    const defaultUrls = this.defaultRPCs[chainId];
    if (defaultUrls && defaultUrls.length > 0) {
      return defaultUrls;
    }
    
    // Final fallback to generic default
    const genericDefault = process.env.RPC_URL;
    if (genericDefault) {
      return this.parseRPCUrls(genericDefault);
    }
    
    return ["https://eth.drpc.org"];
  }

  /**
   * Initialize RPC configuration for a chain if not already done.
   */
  private ensureChainConfig(chainId: number): void {
    if (this.chainConfigs.has(chainId)) {
      return;
    }

    const urls = this.getRPCUrlsForChain(chainId);
    const endpoints = urls.map(url => ({
      url,
      failures: 0,
      totalRequests: 0,
      successfulRequests: 0,
      tokenBucket: TokenBucketFactory.createForRPC(url, chainId),
      lastUsed: 0,
    }));

    this.chainConfigs.set(chainId, {
      endpoints,
      currentIndex: 0,
    });

    // console.log(
    //   `[RPC Manager] Initialized ${endpoints.length} RPC(s) for chain ${chainId} with per-RPC rate limiting`
    // );
  }

  /**
   * Get the current RPC URL for a chain.
   */
  getCurrentRPCUrl(chainId: number): string {
    this.ensureChainConfig(chainId);
    
    const config = this.chainConfigs.get(chainId);
    if (!config || config.endpoints.length === 0) {
      return "https://eth.drpc.org";
    }

    const endpoint = config.endpoints[config.currentIndex];
    return endpoint.url;
  }

  /**
   * Select the best available RPC considering rate limits and failures.
   * Returns the index of the best RPC, or null if all are saturated.
   */
  private selectBestRPC(chainId: number): number | null {
    const config = this.chainConfigs.get(chainId);
    if (!config || config.endpoints.length === 0) {
      return null;
    }

    // Score each RPC based on:
    // 1. Token availability (can it accept a request now?)
    // 2. Failure rate
    // 3. Last used time (load balancing)
    
    let bestIndex = config.currentIndex;
    let bestScore = -Infinity;

    for (let i = 0; i < config.endpoints.length; i++) {
      const endpoint = config.endpoints[i];
      
      // Check if RPC has tokens available
      const hasTokens = endpoint.tokenBucket.tryConsume();
      if (hasTokens) {
        // Give back the token (we just checked availability)
        endpoint.tokenBucket.getState(); // refresh state
      }
      
      const tokenState = endpoint.tokenBucket.getState();
      const tokensAvailable = tokenState.tokens;
      const utilizationPercent = tokenState.utilizationPercent;
      
      // Calculate failure rate
      const failureRate = endpoint.totalRequests > 0 
        ? endpoint.failures / endpoint.totalRequests 
        : 0;
      
      // Calculate time since last use (prefer RPCs that haven't been used recently)
      const timeSinceLastUse = Date.now() - endpoint.lastUsed;
      
      // Score calculation (higher is better)
      let score = 0;
      
      // Token availability (most important)
      if (tokensAvailable >= 1) {
        score += 1000; // Has tokens available
        score += tokensAvailable * 10; // More tokens = better
      } else {
        score -= 1000; // No tokens available
      }
      
      // Low utilization is better
      score -= utilizationPercent * 5;
      
      // Low failure rate is better (0-100 scale)
      score -= failureRate * 500;
      
      // Prefer RPCs not used recently (load balancing)
      score += Math.min(timeSinceLastUse / 1000, 100); // cap at 100
      
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  /**
   * Get all RPC URLs for a chain (for display/logging purposes).
   */
  getAllRPCUrls(chainId: number): string[] {
    this.ensureChainConfig(chainId);
    
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      return [];
    }

    return config.endpoints.map(ep => ep.url);
  }

  /**
   * Mark current RPC as failed and rotate to next one.
   * Returns the new RPC URL to try.
   */
  rotateToNextRPC(chainId: number): string {
    this.ensureChainConfig(chainId);
    
    const config = this.chainConfigs.get(chainId);
    if (!config || config.endpoints.length === 0) {
      return "https://eth.drpc.org";
    }

    // Mark current endpoint as failed
    config.endpoints[config.currentIndex].failures += 1;

    // Rotate to next endpoint (with wraparound)
    config.currentIndex = (config.currentIndex + 1) % config.endpoints.length;

    const newEndpoint = config.endpoints[config.currentIndex];
    return newEndpoint.url;
  }

  /**
   * Get the number of available RPCs for a chain.
   */
  getRPCCount(chainId: number): number {
    this.ensureChainConfig(chainId);
    
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      return 0;
    }

    return config.endpoints.length;
  }

  /**
   * Reset failure counters for a chain (useful after successful requests).
   */
  resetFailures(chainId: number): void {
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      return;
    }

    for (const endpoint of config.endpoints) {
      endpoint.failures = 0;
    }
  }

  /**
   * Wait for a token from the current RPC's rate limiter.
   * Returns the wait time in ms.
   */
  async waitForRPCToken(chainId: number): Promise<number> {
    this.ensureChainConfig(chainId);
    
    const config = this.chainConfigs.get(chainId);
    if (!config || config.endpoints.length === 0) {
      return 0;
    }

    const endpoint = config.endpoints[config.currentIndex];
    const waitTime = await endpoint.tokenBucket.waitForToken();
    
    return waitTime;
  }

  /**
   * Record a request attempt for the current RPC.
   */
  recordRequest(chainId: number, success: boolean): void {
    const config = this.chainConfigs.get(chainId);
    if (!config || config.endpoints.length === 0) {
      return;
    }

    const endpoint = config.endpoints[config.currentIndex];
    endpoint.totalRequests += 1;
    endpoint.lastUsed = Date.now();
    
    if (success) {
      endpoint.successfulRequests += 1;
    }
  }

  /**
   * Proactively select best RPC based on rate limits and load.
   * Updates currentIndex to point to the best RPC.
   */
  selectBestAvailableRPC(chainId: number): void {
    const bestIndex = this.selectBestRPC(chainId);
    if (bestIndex !== null) {
      const config = this.chainConfigs.get(chainId);
      if (config && config.currentIndex !== bestIndex) {
        const oldUrl = config.endpoints[config.currentIndex].url;
        const newUrl = config.endpoints[bestIndex].url;
        config.currentIndex = bestIndex;
        
        // console.log(
        //   `[RPC Manager] Chain ${chainId}: Proactively switched RPC\n` +
        //   `  From: ${new URL(oldUrl).hostname}\n` +
        //   `  To: ${new URL(newUrl).hostname} (better rate limit availability)`
        // );
      }
    }
  }
}

// Singleton instance
const rpcManager = new RPCManager();

/**
 * Execute an RPC call with automatic retry and rotation.
 * Tries all available RPCs for the chain before giving up.
 * 
 * Implements multi-layer rate limiting:
 * 1. Per-chain throttle queue (concurrency + rate limit)
 * 2. Per-RPC rate limiting (individual RPC token buckets)
 * 3. Intelligent RPC selection (best available based on load)
 * 
 * @param chainId - The chain ID to execute the call on
 * @param operation - Async function that takes a PublicClient and performs the RPC call
 * @param options - Optional configuration for batch and multicall
 * @returns The result of the operation
 * @throws Error if all RPCs fail
 */
export async function executeWithRPCRotation<T>(
  chainId: number,
  operation: (client: any) => Promise<T>,
  options?: {
    enableBatch?: boolean;
    enableMulticall?: boolean;
  }
): Promise<T> {
  // Wrap the entire operation in the throttle queue
  // This provides Layer 1: Per-chain concurrency + rate limiting
  return await rpcThrottleManager.executeThrottled(chainId, async () => {
    const chain = getChain(chainId);
    const maxAttempts = rpcManager.getRPCCount(chainId);
    const enableBatch = options?.enableBatch ?? true;
    const enableMulticall = options?.enableMulticall ?? true;

    let lastError: Error | null = null;

    // Try each RPC endpoint once (bounded iteration)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Layer 2: Select best available RPC based on rate limits and load
      rpcManager.selectBestAvailableRPC(chainId);
      
      const rpcUrl = rpcManager.getCurrentRPCUrl(chainId);
      
      // Layer 3: Wait for per-RPC rate limit token
      const waitTime = await rpcManager.waitForRPCToken(chainId);
      if (waitTime > 0) {
        // console.log(
        //   `[RPC Manager] Chain ${chainId}: Waited ${Math.round(waitTime)}ms ` +
        //   `for RPC rate limit (${new URL(rpcUrl).hostname})`
        // );
      }
      
      try {
        // Record request attempt
        rpcManager.recordRequest(chainId, false); // Will update to true on success
        
        // Create client with current RPC
        const client = createPublicClient({
          chain: chain,
          batch: enableMulticall ? { multicall: true } : undefined,
          transport: http(rpcUrl, { batch: enableBatch }),
        });

        // Execute the operation
        const result = await operation(client);
        
        // Success - update stats and reset failure counters
        rpcManager.recordRequest(chainId, true);
        rpcManager.resetFailures(chainId);
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        console.error(
          `RPC call failed for chain ${chainId} using ${new URL(rpcUrl).hostname}. ` +
          `Attempt ${attempt + 1}/${maxAttempts}. Error: ${lastError.message}`
        );

        // Rotate to next RPC for next attempt
        if (attempt < maxAttempts - 1) {
          const nextRpc = rpcManager.rotateToNextRPC(chainId);
          // console.log(`[RPC Manager] Rotating to next RPC: ${new URL(nextRpc).hostname}`);
        }
      }
    }

    // All RPCs failed
    const allRpcs = rpcManager.getAllRPCUrls(chainId);
    throw new Error(
      `All RPC endpoints failed for chain ${chainId}. ` +
      `Tried ${allRpcs.length} endpoints: ${allRpcs.join(", ")}. ` +
      `Last error: ${lastError?.message || "Unknown error"}`
    );
  });
}

/**
 * Get the current RPC URL for a chain (for backward compatibility).
 */
export function getRPCUrl(chainId: number): string {
  return rpcManager.getCurrentRPCUrl(chainId);
}

/**
 * Get all available RPC URLs for a chain.
 */
export function getAllRPCUrls(chainId: number): string[] {
  return rpcManager.getAllRPCUrls(chainId);
}

export { rpcManager };
