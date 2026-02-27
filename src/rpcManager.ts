import { createPublicClient, http, PublicClient } from "viem";
import { getChain } from "./utils";

/**
 * RPC Manager for handling multiple RPC endpoints per chain with automatic rotation.
 *
 * Features:
 * - Parses comma-separated RPC URLs from environment variables
 * - Automatically rotates to next RPC on failure
 * - Request tracking per RPC endpoint
 * - Bounded retry mechanism (tries all available RPCs once)
 * - Thread-safe RPC index tracking per chain
 */

interface RPCEndpoint {
  url: string;
  failures: number;
  totalRequests: number;
  successfulRequests: number;
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
      lastUsed: 0,
    }));

    this.chainConfigs.set(chainId, {
      endpoints,
      currentIndex: 0,
    });
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
}

// Singleton instance
const rpcManager = new RPCManager();

/**
 * Execute an RPC call with automatic retry and rotation.
 * Tries all available RPCs for the chain before giving up.
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
  const chain = getChain(chainId);
  const maxAttempts = rpcManager.getRPCCount(chainId);
  const enableBatch = options?.enableBatch ?? true;
  const enableMulticall = options?.enableMulticall ?? true;

  let lastError: Error | null = null;

  // Try each RPC endpoint once (bounded iteration)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rpcUrl = rpcManager.getCurrentRPCUrl(chainId);

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
