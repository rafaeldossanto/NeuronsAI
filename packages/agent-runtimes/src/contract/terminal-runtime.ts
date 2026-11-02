import type { AgentRuntime } from "./agent-runtime.js";
import type { Unsubscribe } from "./signal.js";

/**
 * An agent that lives in a terminal a person can watch and type into. The raw output is
 * ephemeral: whoever hosts the runtime publishes it live, but it is never stored in the run log.
 */
export interface TerminalAgentRuntime extends AgentRuntime {
  /** Raw terminal output (escape sequences included), as the terminal emulator must receive it. */
  onOutput(listener: (chunk: string) => void): Unsubscribe;

  /** The latest output (about the last 200 KB), for whoever connects after the session started. */
  outputSnapshot(): string;

  /** Types into the terminal as the user would. */
  writeInput(data: string): void;
}

export const isTerminalRuntime = (runtime: AgentRuntime): runtime is TerminalAgentRuntime =>
  "outputSnapshot" in runtime && "writeInput" in runtime && "onOutput" in runtime;
