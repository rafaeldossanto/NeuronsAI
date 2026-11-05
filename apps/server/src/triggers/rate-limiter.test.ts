import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("allows a burst up to the per-minute limit and then refuses", () => {
    let now = 0;
    const limiter = new RateLimiter(3, () => now);
    expect([1, 2, 3, 4].map(() => limiter.tryTake("a"))).toEqual([true, true, true, false]);
    now += 1;
    expect(limiter.tryTake("a")).toBe(false);
  });

  it("refills evenly: one token every 60/limit seconds", () => {
    let now = 0;
    const limiter = new RateLimiter(6, () => now); // one token every 10 s
    for (let i = 0; i < 6; i++) limiter.tryTake("a");
    expect(limiter.tryTake("a")).toBe(false);
    now += 9_999;
    expect(limiter.tryTake("a")).toBe(false);
    now += 1;
    expect(limiter.tryTake("a")).toBe(true);
    expect(limiter.tryTake("a")).toBe(false);
  });

  it("never holds more than the limit, however long it was idle", () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    now += 3_600_000;
    expect([1, 2, 3].map(() => limiter.tryTake("a"))).toEqual([true, true, false]);
  });

  it("counts each key on its own", () => {
    const limiter = new RateLimiter(1, () => 0);
    expect(limiter.tryTake("a")).toBe(true);
    expect(limiter.tryTake("a")).toBe(false);
    expect(limiter.tryTake("b")).toBe(true);
  });

  it("suggests a retry delay of at least one second", () => {
    expect(new RateLimiter(60).retryAfterSec()).toBe(1);
    expect(new RateLimiter(2).retryAfterSec()).toBe(30);
  });
});
