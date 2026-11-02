import { loadXterm } from "./native.js";

export type FooterState = "free" | "busy" | "unknown";

/**
 * Footer of Claude Code 2.1.x. While it works the spinner line says `esc to interrupt`; with the
 * input box free the footer shows `? for shortcuts` or, when a permission mode other than the plain
 * one is active, that mode and `(shift+tab to cycle)`.
 */
const BUSY_FOOTER = /esc to interrupt/;
const FREE_FOOTER = /\? for shortcuts|shift\+tab to cycle/;

/**
 * The rendered screen of the CLI. The CLI repaints with escape sequences instead of printing
 * lines, so the only reliable way to read it is to feed the bytes to a terminal emulator.
 */
export class TerminalScreen {
  private readonly terminal: InstanceType<ReturnType<typeof loadXterm>["Terminal"]>;

  constructor(cols: number, rows: number) {
    this.terminal = new (loadXterm().Terminal)({ cols, rows, allowProposedApi: true });
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  /** The visible rows, without escape sequences or trailing spaces. */
  text(): string {
    const buffer = this.terminal.buffer.active;
    const rows: string[] = [];
    for (let row = 0; row < this.terminal.rows; row++) {
      rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    }
    return rows.join("\n").replace(/\s+$/, "");
  }

  /** The footer, not the input box (which stays on screen during a turn too). */
  footer(): FooterState {
    const text = this.text();
    if (BUSY_FOOTER.test(text)) return "busy";
    return FREE_FOOTER.test(text) ? "free" : "unknown";
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
