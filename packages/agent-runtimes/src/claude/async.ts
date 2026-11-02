export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** One-shot notifications: everyone waiting when `fire` is called is released. Nothing is remembered. */
export class Gate {
  private waiters: (() => void)[] = [];

  get hasWaiters(): boolean {
    return this.waiters.length > 0;
  }

  /** Registers synchronously, so a `fire` right after this call is never missed. */
  wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  fire(): void {
    const released = this.waiters;
    this.waiters = [];
    for (const release of released) release();
  }
}

/** Resolves `true` if the promise settles first, `false` if `ms` pass. */
export async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface WaitOptions {
  timeoutMs: number;
  signal: AbortSignal;
  pollMs: number;
}

/**
 * Polls `condition` until it holds. Resolves `true` then, `false` on timeout or abort; whatever the
 * condition throws rejects the wait (used to stop a boot at once, e.g. when a login is required).
 */
export async function waitUntil(condition: () => boolean, options: WaitOptions): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  while (!options.signal.aborted && Date.now() < deadline) {
    if (condition()) return true;
    await sleep(options.pollMs);
  }
  return !options.signal.aborted && condition();
}
