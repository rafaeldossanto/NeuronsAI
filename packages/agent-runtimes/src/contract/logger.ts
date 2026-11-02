/** Where runtimes report what an operator should know. Never receives tokens or message bodies. */
export interface RuntimeLogger {
  warn(message: string): void;
  error(message: string): void;
}

export const silentLogger: RuntimeLogger = { warn: () => undefined, error: () => undefined };
