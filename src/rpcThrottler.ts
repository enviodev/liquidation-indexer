/**
 * RPC Request Throttler - Per-Chain Concurrency & Rate Limiting
 * 
 * Implements a comprehensive throttling system with:
 * 1. Concurrency limiting (max N requests at once)
 * 2. Rate limiting (max M requests per second via token bucket)
 * 
 * This dual approach prevents both:
 * - Burst overload (concurrency limit)
 * - Sustained high rate (token bucket)
 * 
 * Features:
 * - Per-chain request queues
 * - Configurable max concurrent requests
 * - Token bucket rate limiting
 * - FIFO queue processing
 * - Detailed logging for monitoring and tuning
 */

import { TokenBucket, TokenBucketFactory } from "./tokenBucket";

interface QueuedRequest<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Request queue for a single chain with concurrency and rate limiting.
 */
class RPCRequestQueue {
  private maxConcurrent: number;
  private activeRequests: number;
  private queue: QueuedRequest<any>[];
  private chainId: number;
  private tokenBucket: TokenBucket;

  constructor(chainId: number, maxConcurrent: number) {
    this.chainId = chainId;
    this.maxConcurrent = maxConcurrent;
    this.activeRequests = 0;
    this.queue = [];
    this.tokenBucket = TokenBucketFactory.createForChain(chainId);
  }

  /**
   * Execute an operation with concurrency limiting.
   * If under the concurrent limit, executes immediately.
   * Otherwise, queues the operation until a slot is available.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // If we're under the limit, execute immediately
    if (this.activeRequests < this.maxConcurrent) {
      return await this.executeImmediate(operation);
    }

    // Otherwise, queue the request
    return await this.queueRequest(operation);
  }

  /**
   * Execute a request immediately (when under concurrency limit).
   * Also enforces rate limiting via token bucket.
   */
  private async executeImmediate<T>(operation: () => Promise<T>): Promise<T> {
    this.activeRequests++;

    try {
      const result = await operation();
      return result;
    } finally {
      this.onRequestComplete();
    }
  }

  /**
   * Queue a request to be executed when a slot becomes available.
   */
  private async queueRequest<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
    });
  }

  /**
   * Called when a request completes. Processes the next queued request if any.
   */
  private onRequestComplete(): void {
    this.activeRequests--;

    // Process next request in queue if available
    if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      this.processNextInQueue();
    }
  }

  /**
   * Process the next request from the queue.
   * Also enforces rate limiting via token bucket.
   */
  private async processNextInQueue(): Promise<void> {
    const nextRequest = this.queue.shift();
    if (!nextRequest) {
      return;
    }

    this.activeRequests++;

    // Execute the queued operation
    nextRequest.operation()
      .then((result) => {
        nextRequest.resolve(result);
      })
      .catch((error) => {
        nextRequest.reject(error);
      })
      .finally(() => {
        this.onRequestComplete();
      });
  }

  /**
   * Get current queue statistics for monitoring.
   */
  getStats(): { 
    active: number; 
    queued: number; 
    maxConcurrent: number;
    rateLimit: {
      tokens: number;
      capacity: number;
      refillRate: number;
      utilizationPercent: number;
    };
  } {
    return {
      active: this.activeRequests,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      rateLimit: this.tokenBucket.getState(),
    };
  }
}

/**
 * Manages request queues for all chains with per-chain concurrency limiting.
 */
class RPCThrottleManager {
  private queues: Map<number, RPCRequestQueue>;
  private defaultMaxConcurrent: number;

  constructor() {
    this.queues = new Map();
    this.defaultMaxConcurrent = this.parseDefaultMaxConcurrent();
  }

  /**
   * Parse the default max concurrent requests from environment variables.
   */
  private parseDefaultMaxConcurrent(): number {
    const envValue = process.env.RPC_MAX_CONCURRENT;
    if (!envValue) {
      return 15; // Conservative default
    }

    const parsed = parseInt(envValue, 10);
    if (isNaN(parsed) || parsed < 1) {
      console.warn(
        `Invalid RPC_MAX_CONCURRENT value: ${envValue}. Using default: 15`
      );
      return 15;
    }

    return parsed;
  }

  /**
   * Get the max concurrent requests for a specific chain.
   */
  private getMaxConcurrentForChain(chainId: number): number {
    const envKey = `RPC_MAX_CONCURRENT_${chainId}`;
    const envValue = process.env[envKey];

    if (!envValue) {
      return this.defaultMaxConcurrent;
    }

    const parsed = parseInt(envValue, 10);
    if (isNaN(parsed) || parsed < 1) {
      console.warn(
        `Invalid ${envKey} value: ${envValue}. ` +
        `Using default: ${this.defaultMaxConcurrent}`
      );
      return this.defaultMaxConcurrent;
    }

    return parsed;
  }

  /**
   * Get or create the request queue for a specific chain.
   */
  private getQueue(chainId: number): RPCRequestQueue {
    let queue = this.queues.get(chainId);
    
    if (!queue) {
      const maxConcurrent = this.getMaxConcurrentForChain(chainId);
      queue = new RPCRequestQueue(chainId, maxConcurrent);
      this.queues.set(chainId, queue);
    }

    return queue;
  }

  /**
   * Execute an operation with throttling for a specific chain.
   * This is the main entry point for throttled RPC requests.
   */
  async executeThrottled<T>(
    chainId: number,
    operation: () => Promise<T>
  ): Promise<T> {
    const queue = this.getQueue(chainId);
    return await queue.execute(operation);
  }

  /**
   * Get statistics for all chains (for monitoring/debugging).
   */
  getAllStats(): Record<number, { active: number; queued: number; maxConcurrent: number }> {
    const stats: Record<number, any> = {};
    
    for (const [chainId, queue] of this.queues.entries()) {
      stats[chainId] = queue.getStats();
    }

    return stats;
  }
}

// Singleton instance
export const rpcThrottleManager = new RPCThrottleManager();
