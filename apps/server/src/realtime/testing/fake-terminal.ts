import {
  Signal,
  type TerminalAgentRuntime,
  type TerminalSize,
  DEFAULT_TERMINAL_SIZE,
} from "@neurons/agent-runtimes";

/** Just the terminal side of a runtime, for the tests of the pieces that sit on top of one. */
export class FakeTerminal {
  readonly typed: string[] = [];
  /** Every size it took, in order. */
  readonly resized: TerminalSize[] = [];
  /** Makes `writeInput` throw, like a runtime whose PTY died. */
  failWith: Error | undefined;
  size: TerminalSize = { ...DEFAULT_TERMINAL_SIZE };
  private readonly output = new Signal<string>();
  private readonly resizes = new Signal<TerminalSize>();
  private buffer = "";

  print(chunk: string): void {
    this.buffer += chunk;
    this.output.emit(chunk);
  }

  onOutput = (listener: (chunk: string) => void) => this.output.subscribe(listener);
  onResize = (listener: (size: TerminalSize) => void) => this.resizes.subscribe(listener);
  outputSnapshot = () => this.buffer;

  writeInput = (data: string) => {
    if (this.failWith) throw this.failWith;
    this.typed.push(data);
  };

  /** Like the real runtimes: the same size is nothing, a new one restarts the replay. */
  resize = (cols: number, rows: number) => {
    if (cols === this.size.cols && rows === this.size.rows) return;
    this.size = { cols, rows };
    this.resized.push({ cols, rows });
    this.buffer = "";
    this.resizes.emit({ cols, rows });
  };

  asRuntime = () => this as unknown as TerminalAgentRuntime;
}
