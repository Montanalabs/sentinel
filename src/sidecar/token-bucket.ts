/**
 * Token-bucket rate limiter used by the sidecar to cap request rate on `/v1/*`
 * routes. A monotonic, lazily-refilled bucket: callers spend a token per request
 * and are refused (HTTP 429 upstream) when the bucket is empty.
 */

/** Construction options for a {@link TokenBucket}. */
export interface TokenBucketOptions {
  /** Maximum tokens the bucket holds (the burst ceiling). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
  /** Monotonic clock in milliseconds; injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/** A simple token-bucket rate limiter (monotonic, lazily refilled). */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly now: () => number;

  constructor(private readonly opts: TokenBucketOptions) {
    this.tokens = opts.capacity;
    this.now = opts.now ?? Date.now;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.last) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.opts.capacity, this.tokens + elapsedSec * this.opts.refillPerSec);
      this.last = t;
    }
  }

  /**
   * Consume one token.
   *
   * @returns `true` if a token was available and consumed, `false` if the bucket
   *   is currently empty.
   */
  tryRemove(): boolean {
    return this.tryRemoveN(1);
  }

  /**
   * Atomically consume `n` tokens, or none.
   *
   * Used to charge a batch request for all its sub-requests at once, so a single token can't buy
   * 256 units of work. Consumes nothing unless the full `n` is available.
   *
   * @param n - Number of tokens to consume (`<= 0` is a no-op that succeeds).
   * @returns `true` if `n` tokens were available and consumed, `false` otherwise.
   */
  tryRemoveN(n: number): boolean {
    if (n <= 0) return true;
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}
