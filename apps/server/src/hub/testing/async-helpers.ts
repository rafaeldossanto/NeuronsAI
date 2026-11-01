import { vi } from "vitest";

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retries the assertion until it passes (the Hub works in the background). */
export const eventually = (assertion: () => void | Promise<void>): Promise<void> =>
  vi.waitFor(assertion, { timeout: 3_000, interval: 5 });

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
