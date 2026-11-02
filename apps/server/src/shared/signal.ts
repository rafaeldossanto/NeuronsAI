import { Logger } from "@nestjs/common";
import { Signal as BaseSignal } from "@neurons/agent-runtimes";

export type { Unsubscribe } from "@neurons/agent-runtimes";

const logger = new Logger("Signal");

/** The runtimes' signal, with listener failures going to the Nest logger. */
export class Signal<T> extends BaseSignal<T> {
  constructor() {
    super(logListenerError);
  }
}

function logListenerError(error: unknown): void {
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
}
