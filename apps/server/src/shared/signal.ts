import { Logger } from "@nestjs/common";

export type Unsubscribe = () => void;

type Listener<T> = (value: T) => void | Promise<void>;

const logger = new Logger("Signal");

/**
 * Minimal synchronous event source. A failing listener (thrown or rejected) is logged and never
 * affects the emitter nor the other listeners.
 */
export class Signal<T> {
  private readonly listeners = new Set<Listener<T>>();

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        const outcome = listener(value);
        if (outcome) outcome.catch(logListenerError);
      } catch (error) {
        logListenerError(error);
      }
    }
  }
}

function logListenerError(error: unknown): void {
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
}
