export type Unsubscribe = () => void;

type Listener<T> = (value: T) => void | Promise<void>;

/**
 * Minimal synchronous event source. A failing listener (thrown or rejected) is reported to
 * `onListenerError` and never affects the emitter nor the other listeners.
 */
export class Signal<T> {
  private readonly listeners = new Set<Listener<T>>();

  constructor(
    private readonly onListenerError: (error: unknown) => void = (error) => console.error(error),
  ) {}

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
        // A listener typed `void` may still return a value (e.g. `array.push`): only a promise matters.
        if (outcome instanceof Promise) outcome.catch(this.onListenerError);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
