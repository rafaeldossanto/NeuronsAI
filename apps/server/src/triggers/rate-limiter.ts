/** Token bucket per key: a burst of `perMinute`, refilled evenly over the minute. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes one token; false when the key is out of them (the request should be refused). */
  tryTake(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.perMinute, updatedAt: now };
    const refilled = (now - bucket.updatedAt) * (this.perMinute / 60_000);
    bucket.tokens = Math.min(this.perMinute, bucket.tokens + refilled);
    bucket.updatedAt = now;
    // Re-inserted last, so the map stays ordered from the least to the most recently used key.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    this.prune();
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Seconds until one token is available again, for `Retry-After`. */
  retryAfterSec(): number {
    return Math.max(1, Math.ceil(60 / this.perMinute));
  }

  /** The keys are trigger ids plus one shared bucket, so this stays small; the cap is a backstop. */
  private prune(): void {
    while (this.buckets.size > 10_000) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) return;
      this.buckets.delete(oldest);
    }
  }
}
