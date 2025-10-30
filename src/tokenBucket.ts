/**
 * Token Bucket Rate Limiter
 * 
 * Implements the token bucket algorithm for rate limiting RPC requests.
 * Allows bursts up to capacity while enforcing a sustained rate.
 * 
 * Key Concepts:
 * - Capacity: Maximum tokens (burst limit)
 * - Refill Rate: Tokens added per second (sustained rate)
 * - Token = Permission to make 1 request
 * 
 * Example:
 * - Capacity: 50 tokens (can burst 50 requests)
 * - Refill Rate: 20 tokens/sec (sustained 20 req/sec)
 */

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number; // timestamp in ms
  private identifier: string; // for logging (e.g., "Chain 1" or "RPC: https://...")

  /**
   * Create a new token bucket.
   * 
   * @param capacity - Maximum tokens (burst limit)
   * @param refillRate - Tokens added per second (sustained rate)
   * @param identifier - Identifier for logging purposes
   */
  constructor(capacity: number, refillRate: number, identifier: string) {
    this.capacity = capacity;
    this.tokens = capacity; // Start full
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
    this.identifier = identifier;
  }

  /**
   * Refill tokens based on time elapsed since last refill.
   * Called automatically before each consumption attempt.
   */
  private refill(): void {
    const now = Date.now();
    const timeSinceLastRefill = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timeSinceLastRefill * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Try to consume a token. Returns true if successful, false if bucket is empty.
   * Does not wait - use waitForToken() if you need to wait.
   */
  tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Wait until a token is available, then consume it.
   * Returns the wait time in milliseconds.
   */
  async waitForToken(): Promise<number> {
    this.refill();

    // If tokens available, consume immediately
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }

    // Calculate wait time needed for next token
    const tokensNeeded = 1 - this.tokens;
    const waitTimeMs = (tokensNeeded / this.refillRate) * 1000;

    // console.log(
    //   `[RateLimit] ${this.identifier}: Rate limit reached. ` +
    //   `Waiting ${Math.round(waitTimeMs)}ms for token. ` +
    //   `(tokens: ${this.tokens.toFixed(2)}/${this.capacity}, ` +
    //   `rate: ${this.refillRate}/sec)`
    // );

    // Wait for token to be available
    await new Promise(resolve => setTimeout(resolve, waitTimeMs));

    // Refill and consume
    this.refill();
    this.tokens -= 1;

    return waitTimeMs;
  }

  /**
   * Get current state for monitoring.
   */
  getState(): {
    tokens: number;
    capacity: number;
    refillRate: number;
    utilizationPercent: number;
  } {
    this.refill();
    return {
      tokens: this.tokens,
      capacity: this.capacity,
      refillRate: this.refillRate,
      utilizationPercent: ((this.capacity - this.tokens) / this.capacity) * 100,
    };
  }

  /**
   * Reset the bucket to full capacity.
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

/**
 * Factory for creating token buckets with standard configurations.
 */
export class TokenBucketFactory {
  /**
   * Create a token bucket for a chain with configuration from environment variables.
   */
  static createForChain(chainId: number): TokenBucket {
    // Try per-chain config first
    const capacityKey = `RPC_RATE_CAPACITY_${chainId}`;
    const rateKey = `RPC_RATE_LIMIT_${chainId}`;

    const capacity = this.parseEnvInt(
      capacityKey,
      this.parseEnvInt('RPC_RATE_CAPACITY', 50)
    );
    const refillRate = this.parseEnvInt(
      rateKey,
      this.parseEnvInt('RPC_RATE_LIMIT', 20)
    );

    return new TokenBucket(capacity, refillRate, `Chain ${chainId}`);
  }

  /**
   * Create a token bucket for a specific RPC endpoint.
   */
  static createForRPC(rpcUrl: string, chainId: number): TokenBucket {
    // Use chain's config as default for this RPC
    const chainCapacity = this.parseEnvInt(
      `RPC_RATE_CAPACITY_${chainId}`,
      this.parseEnvInt('RPC_RATE_CAPACITY', 50)
    );
    const chainRate = this.parseEnvInt(
      `RPC_RATE_LIMIT_${chainId}`,
      this.parseEnvInt('RPC_RATE_LIMIT', 20)
    );

    // Extract domain for cleaner logging
    const domain = new URL(rpcUrl).hostname;

    return new TokenBucket(
      chainCapacity,
      chainRate,
      `RPC: ${domain} (Chain ${chainId})`
    );
  }

  /**
   * Parse integer from environment variable with fallback.
   */
  private static parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) {
      return defaultValue;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1) {
      console.warn(
        `Invalid ${key} value: ${value}. Using default: ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }
}
