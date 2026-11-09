import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import type { TerminalMeta } from "./types";

/** The size of the pseudo-terminal the server opens for an agent, until a viewer says another. */
export const TERMINAL_COLS = 120;
export const TERMINAL_ROWS = 40;

/** How long the box must stay still before its size is reported (dragging a window sends many). */
export const RESIZE_DEBOUNCE_MS = 200;

interface Props {
  /** Everything the agent's terminal printed (`RunLiveState.terminals`). */
  output: string;
  meta: TerminalMeta | undefined;
  /** Keystrokes and pastes, exactly as typed. Never logged here. */
  onInput: (data: string) => void;
  /**
   * How many columns and rows of the terminal fit in the box here. Reported (debounced) when the
   * box changes size; the server gives the terminal the smallest size among its viewers.
   */
  onResize: (cols: number, rows: number) => void;
  /** True when nothing can be typed (the run is over). */
  readOnly: boolean;
  label: string;
}

/**
 * xterm.js showing the agent's terminal. It keeps the screen in step with the state without ever
 * adding things twice: after a reconnection the server sends a snapshot (`meta.resets` goes up) and
 * the screen is wiped and drawn again from it; otherwise only the characters added since the last
 * write are written.
 *
 * The size is the server terminal's own (`meta.cols`/`meta.rows`): the TUI inside lays itself out
 * for it, so fitting the screen to the box would garble the output of the others. What the box can
 * show is measured with `@xterm/addon-fit` and reported through `onResize`; the server answers with
 * the size it took (the smallest among the viewers) and the screen follows. A box bigger than the
 * terminal just has room left over; a smaller one scrolls.
 */
export function TerminalView({ output, meta, onInput, onResize, readOnly, label }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const written = useRef<TerminalMeta | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    onInputRef.current = onInput;
    onResizeRef.current = onResize;
    readOnlyRef.current = readOnly;
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const terminal = new Terminal({
      cols: TERMINAL_COLS,
      rows: TERMINAL_ROWS,
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      fontSize: 12,
      scrollback: 5000,
      cursorBlink: true,
      theme: { background: "#1d1f26", foreground: "#f7f7f4", cursor: "#e9a15c" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    const subscription = terminal.onData((data) => onInputRef.current(data));
    term.current = terminal;
    written.current = null;

    // Only the box is measured (`proposeDimensions`), never applied: the terminal takes the size
    // the server gives it. The same size twice is not reported again.
    let reported = "";
    const report = () => {
      if (readOnlyRef.current) return;
      const size = fit.proposeDimensions();
      if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
      const cols = Math.floor(size.cols);
      const rows = Math.floor(size.rows);
      if (cols < 1 || rows < 1 || `${cols}x${rows}` === reported) return;
      reported = `${cols}x${rows}`;
      onResizeRef.current(cols, rows);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(report, RESIZE_DEBOUNCE_MS);
    };
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    if (frame.current) observer?.observe(frame.current);
    schedule();

    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      subscription.dispose();
      terminal.dispose();
      term.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    terminal.options.disableStdin = readOnly;
  }, [readOnly]);

  // Before the output effect: a snapshot comes with the size it was printed at.
  const cols = meta?.cols;
  const rows = meta?.rows;
  useEffect(() => {
    const terminal = term.current;
    if (!terminal || cols === undefined || rows === undefined) return;
    if (terminal.cols !== cols || terminal.rows !== rows) terminal.resize(cols, rows);
  }, [cols, rows]);

  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    const now = meta ?? { resets: 0, total: output.length };
    const before = written.current;
    const added = before ? now.total - before.total : 0;
    if (!before || before.resets !== now.resets || added < 0 || added > output.length) {
      terminal.reset();
      if (output) terminal.write(output);
    } else if (added > 0) {
      terminal.write(output.slice(output.length - added));
    }
    written.current = now;
  }, [output, meta]);

  return (
    <div ref={frame} className="h-[32rem] max-w-full overflow-auto rounded-md bg-[#1d1f26] p-2">
      <div ref={host} role="group" aria-label={label} className="h-full w-full" />
    </div>
  );
}
