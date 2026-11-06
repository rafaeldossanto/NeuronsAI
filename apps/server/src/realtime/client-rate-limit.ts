/**
 * A bucket of `capacity` tokens per client that refills at `capacity` per second: bursts pass, a
 * flood does not. The state hangs off the client object, so it goes away with the connection.
 */
export class ClientRateLimit {
  private readonly buckets = new WeakMap<object, { tokens: number; at: number }>();

  constructor(private readonly capacity: number) {}

  /** True when the client may send now (and uses one token); false when it must wait. */
  take(client: object): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(client) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + ((now - bucket.at) / 1000) * this.capacity,
    );
    bucket.at = now;
    this.buckets.set(client, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
