import type { TerminalSize } from "@neurons/agent-runtimes";

/**
 * What `terminal.resize` may ask for. Narrower than the protocol's own bound on purpose: a few
 * hundred columns is already a very wide screen, and a PTY with thousands of cells per row makes
 * every repaint of the CLI (and the replay) huge.
 */
export const TERMINAL_RESIZE_LIMITS = {
  minCols: 20,
  maxCols: 400,
  minRows: 5,
  maxRows: 200,
  /** Resizes per second one connection may send (a burst of that many is allowed). */
  maxPerSecond: 5,
} as const;

export const isAllowedTerminalSize = (cols: number, rows: number): boolean =>
  cols >= TERMINAL_RESIZE_LIMITS.minCols &&
  cols <= TERMINAL_RESIZE_LIMITS.maxCols &&
  rows >= TERMINAL_RESIZE_LIMITS.minRows &&
  rows <= TERMINAL_RESIZE_LIMITS.maxRows;

/**
 * The rule for several viewers of one terminal: the PTY takes the **smallest** size among the
 * connected viewers (columns and rows each), like tmux. Every viewer then sees the whole screen as
 * the program laid it out; a bigger window just has unused room around it. The size grows back
 * when the small viewer leaves.
 */
export class TerminalSizeNegotiation {
  private readonly bySession = new Map<string, Map<object, TerminalSize>>();

  /** Records what `client` can show of this terminal. @returns the size the terminal should have. */
  report(client: object, runId: string, agent: string, size: TerminalSize): TerminalSize {
    const key = keyOf(runId, agent);
    const sizes = this.bySession.get(key) ?? new Map<object, TerminalSize>();
    this.bySession.set(key, sizes);
    sizes.set(client, { cols: size.cols, rows: size.rows });
    return smallest(sizes);
  }

  /** The size the viewers of this terminal call for now, if any viewer has said. */
  current(runId: string, agent: string): TerminalSize | undefined {
    const sizes = this.bySession.get(keyOf(runId, agent));
    return sizes && sizes.size > 0 ? smallest(sizes) : undefined;
  }

  /**
   * A viewer left (a closed connection, or `runId` when it only left that run): forgets what it
   * reported. @returns each terminal it had a say in, with the size it should have now (undefined
   * when nobody is left to ask: the terminal keeps the size it has).
   */
  forget(
    client: object,
    runId?: string,
  ): { runId: string; agent: string; size: TerminalSize | undefined }[] {
    const changed: { runId: string; agent: string; size: TerminalSize | undefined }[] = [];
    for (const [key, sizes] of [...this.bySession]) {
      const [sessionRun, agent] = splitKey(key);
      if (runId !== undefined && sessionRun !== runId) continue;
      if (!sizes.delete(client)) continue;
      if (sizes.size === 0) this.bySession.delete(key);
      changed.push({
        runId: sessionRun,
        agent,
        size: sizes.size === 0 ? undefined : smallest(sizes),
      });
    }
    return changed;
  }

  /** The terminal is gone (its session ended): nothing to negotiate any more. */
  drop(runId: string, agent: string): void {
    this.bySession.delete(keyOf(runId, agent));
  }
}

const SEPARATOR = "\u0000";
const keyOf = (runId: string, agent: string) => `${runId}${SEPARATOR}${agent}`;
const splitKey = (key: string): [string, string] => {
  const at = key.indexOf(SEPARATOR);
  return [key.slice(0, at), key.slice(at + 1)];
};

function smallest(sizes: Map<object, TerminalSize>): TerminalSize {
  let cols = Infinity;
  let rows = Infinity;
  for (const size of sizes.values()) {
    cols = Math.min(cols, size.cols);
    rows = Math.min(rows, size.rows);
  }
  return { cols, rows };
}
