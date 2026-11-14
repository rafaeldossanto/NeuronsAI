import type { ModelDelta } from "./types.js";

/** How long a stream may stay silent before it counts as stuck (the same 90 s as a plain request). */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;

export class StreamStalledError extends Error {
  constructor() {
    super("O provedor parou de enviar a resposta.");
    this.name = "StreamStalledError";
  }
}

export class StreamCutError extends Error {
  constructor() {
    super("A resposta do provedor foi interrompida antes do fim.");
    this.name = "StreamCutError";
  }
}

/**
 * The timeout of an SDK client covers the wait for the first byte; once a stream is open, only
 * this watchdog notices a model that went quiet. {@link touch} on every event keeps it waiting.
 */
export class StreamGuard {
  private readonly stalled = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly signal: AbortSignal;

  constructor(
    signal: AbortSignal,
    private readonly idleMs: number,
  ) {
    this.signal = AbortSignal.any([signal, this.stalled.signal]);
    this.touch();
  }

  touch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stalled.abort(), this.idleMs);
  }

  get hasStalled(): boolean {
    return this.stalled.signal.aborted;
  }

  /** Stops the watchdog; always call it (a pending timer would keep the process alive). */
  close(): void {
    clearTimeout(this.timer);
  }
}

/**
 * Runs a streamed request under a {@link StreamGuard}: a stuck stream rejects with
 * {@link StreamStalledError} whatever the SDK made of the abort.
 */
export async function guarded<T>(
  signal: AbortSignal,
  idleMs: number,
  run: (guard: StreamGuard) => Promise<T>,
): Promise<T> {
  const guard = new StreamGuard(signal, idleMs);
  try {
    return await run(guard);
  } catch (error) {
    if (guard.hasStalled && !signal.aborted) throw new StreamStalledError();
    throw error;
  } finally {
    guard.close();
  }
}

/** A listener that throws must never end the turn of the model. */
export function safeDelta(listener: (delta: ModelDelta) => void): (delta: ModelDelta) => void {
  return (delta) => {
    try {
      listener(delta);
    } catch {
      // the screen is optional; the turn is not
    }
  };
}
