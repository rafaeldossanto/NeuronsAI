import type { AgentRuntime } from "./agent-runtime.js";
import type { Unsubscribe } from "./signal.js";

/** Size of a terminal, in character cells. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/** The size every terminal opens with, until a viewer asks for another (`terminal.resize`). */
export const DEFAULT_TERMINAL_SIZE: Readonly<TerminalSize> = { cols: 120, rows: 40 };

/**
 * An agent that lives in a terminal a person can watch and type into. The raw output is
 * ephemeral: whoever hosts the runtime publishes it live, but it is never stored in the run log.
 */
export interface TerminalAgentRuntime extends AgentRuntime {
  /** Raw terminal output (escape sequences included), as the terminal emulator must receive it. */
  onOutput(listener: (chunk: string) => void): Unsubscribe;

  /**
   * The latest output (about the last 200 KB), for whoever connects after the session started. It
   * starts at the last resize: older bytes were laid out for another size and would garble the
   * screen, so they are dropped (the CLI repaints itself when the size changes). {@link size} is the
   * size the snapshot was produced at.
   */
  outputSnapshot(): string;

  /** The current size of the terminal (the PTY and the screen kept for reading it). */
  readonly size: TerminalSize;

  /**
   * Resizes the terminal: the PTY (the program inside gets the new size and repaints) and the screen
   * kept for reading it, and restarts the replay buffer. The same size is a no-op. Does nothing once
   * the session ended. The listeners of {@link onResize} hear the size that was applied.
   */
  resize(cols: number, rows: number): void;

  /** The terminal was resized (the applied size). Fires before any output laid out for it. */
  onResize(listener: (size: TerminalSize) => void): Unsubscribe;

  /** Types into the terminal as the user would. */
  writeInput(data: string): void;
}

export const isTerminalRuntime = (runtime: AgentRuntime): runtime is TerminalAgentRuntime =>
  "outputSnapshot" in runtime &&
  "writeInput" in runtime &&
  "onOutput" in runtime &&
  "resize" in runtime;
