import type { IPty } from "node-pty";
import type { BridgeHooks } from "../bridge/local-bridge.js";
import type { AgentCommunication } from "../contract/agent-communication.js";
import type { InboundMessage } from "../contract/agent-runtime.js";
import { Signal, type Unsubscribe } from "../contract/signal.js";
import {
  DEFAULT_TERMINAL_SIZE,
  type TerminalAgentRuntime,
  type TerminalSize,
} from "../contract/terminal-runtime.js";
import { killProcessTree } from "../platform/process-tree.js";
import { guardPtyWrites, isBrokenPipe, releasePtyHandles } from "../platform/pty-handles.js";
import { Gate, settlesWithin, sleep, waitUntil } from "./async.js";
import { ClaudeLoginRequiredError } from "./claude-cli.js";
import {
  ClaudeRuntimeBase,
  errorMessage,
  type ClaudeAgentConfig,
  type ClaudeRuntimeDeps,
  type LaunchContext,
} from "./claude-runtime-base.js";
import { formatInboundMessage } from "./inbound-text.js";
import { loadPty } from "./native.js";
import { OutputBuffer, DEFAULT_OUTPUT_BUFFER_CHARS } from "./output-buffer.js";
import { TerminalScreen } from "./terminal-screen.js";

/** Every wait of the PTY runtime, in one place; the defaults come from the T05 spike measurements. */
export interface TerminalTimings {
  /** From spawn to a usable prompt (measured 7–10 s, plus first-run dialogs). */
  bootTimeoutMs: number;
  /** How long a dialog only the user can answer (trusting the folder) may stay up before the boot gives up. */
  userDialogTimeoutMs: number;
  /** Screen quiet time that, with a free footer, means the CLI is ready. */
  readyQuietMs: number;
  /** How long to wait for the typed text to show up before pressing Enter anyway. */
  echoTimeoutMs: number;
  /** After the echo: a quicker Enter is taken as part of the paste (150 ms failed, 800 ms worked). */
  enterDelayMs: number;
  /** How long a pressed Enter has to be confirmed by the `UserPromptSubmit` hook. */
  submitConfirmMs: number;
  maxEnterAttempts: number;
  /** After `Stop`, how long to wait for the free footer to show before going idle anyway. */
  footerConfirmMs: number;
  /** Without a `Stop` hook for this long, a free footer plus silence is accepted as the end of the turn. */
  hookGraceMs: number;
  /** The silence that safety net asks for. */
  silenceMs: number;
  pollMs: number;
}

export const DEFAULT_TERMINAL_TIMINGS: TerminalTimings = {
  bootTimeoutMs: 90_000,
  userDialogTimeoutMs: 60_000,
  readyQuietMs: 700,
  echoTimeoutMs: 60_000,
  enterDelayMs: 400,
  submitConfirmMs: 6_000,
  maxEnterAttempts: 4,
  footerConfirmMs: 2_000,
  hookGraceMs: 20_000,
  silenceMs: 1_500,
  pollMs: 50,
};

export interface ClaudeTerminalOptions {
  /**
   * Answers "trust this folder" with yes. Off by default: trusting a folder is the user's decision.
   * Only for folders the caller created itself (the e2e script's scratch folder).
   */
  trustWorkingDirectory?: boolean;
  timings?: Partial<TerminalTimings>;
  size?: Partial<TerminalSize>;
  outputBufferChars?: number;
}

interface Dialog {
  name: string;
  pattern: RegExp;
  /** What to type; `undefined` leaves the decision to the person watching the terminal. */
  answer: string | undefined;
}

const TRUST_FOLDER = "trust-folder";

/** First-run screens of Claude Code 2.1.x. Enter picks the option already highlighted (the safe one). */
const DIALOGS: Dialog[] = [
  { name: "theme", pattern: /Choose the text style/i, answer: "\r" },
  {
    name: "security-notes",
    pattern: /Security notes:[\s\S]*Press Enter to continue/i,
    answer: "\r",
  },
  { name: "chrome", pattern: /Claude in Chrome extension detected/i, answer: "\r" },
  // Trusting a folder is the user's decision (see `trustWorkingDirectory`).
  { name: TRUST_FOLDER, pattern: /trust this folder|Do you trust the files/i, answer: undefined },
];
const LOGIN_SCREEN = /Select login method|Paste code here|Login successful/i;

/** What the user has to do when the boot stalls in front of a dialog nobody answered. */
const TRUST_HINT =
  "O Claude Code está pedindo para confiar na pasta do agente. Abra o terminal do agente e responda, ou rode `claude` uma vez nessa pasta.";

const ENTER = "\r";
const ARROW_DOWN = "\x1b[B";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_PLACEHOLDER = /\[Pasted text/;
const ECHO_PROBE_CHARS = 25;

/**
 * Claude Code running in a pseudo-terminal, so a person can watch it and type into it (T14 shows
 * the screen). The turn boundaries do not come from the screen but from the CLI's own hooks:
 * `UserPromptSubmit` confirms an injected message was accepted and `Stop` ends the turn. The
 * screen (footer, silence) only confirms them, or stands in when a hook never arrives.
 */
export class ClaudeTerminalRuntime extends ClaudeRuntimeBase implements TerminalAgentRuntime {
  protected readonly mode = "pty";
  /** The screen of the CLI carries no structured usage. */
  readonly reportsCost = false;

  private readonly timings: TerminalTimings;
  private currentSize: TerminalSize;
  private readonly resizes = new Signal<TerminalSize>();
  private readonly output: OutputBuffer;
  private readonly outputChunks = new Signal<string>();
  private readonly promptSubmitted = new Gate();
  private readonly turnStopped = new Gate();
  private pty: IPty | undefined;
  /** The child exited or is being killed: writes to its terminal would only break the pipe. */
  private ptyEnded = false;
  private screen: TerminalScreen | undefined;
  private exited: Promise<void> = Promise.resolve();
  private lastOutputAt = 0;
  private turnStartedAt = 0;
  private turnSawBusy = false;

  constructor(
    agent: ClaudeAgentConfig,
    communication: AgentCommunication,
    deps: ClaudeRuntimeDeps,
    private readonly options: ClaudeTerminalOptions = {},
  ) {
    super(agent, communication, deps);
    this.timings = { ...DEFAULT_TERMINAL_TIMINGS, ...this.options.timings };
    this.currentSize = { ...DEFAULT_TERMINAL_SIZE, ...this.options.size };
    this.output = new OutputBuffer(this.options.outputBufferChars ?? DEFAULT_OUTPUT_BUFFER_CHARS);
  }

  /** The OS process id of the CLI, while it runs. */
  get processId(): number | undefined {
    return this.pty?.pid;
  }

  // ---- TerminalAgentRuntime ----

  onOutput(listener: (chunk: string) => void): Unsubscribe {
    return this.outputChunks.subscribe(listener);
  }

  outputSnapshot(): string {
    return this.output.snapshot();
  }

  get size(): TerminalSize {
    return { ...this.currentSize };
  }

  onResize(listener: (size: TerminalSize) => void): Unsubscribe {
    return this.resizes.subscribe(listener);
  }

  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
    if (cols === this.currentSize.cols && rows === this.currentSize.rows) return;
    if (this.lifetime.signal.aborted) return;
    this.currentSize = { cols, rows };
    // The bytes kept so far were laid out for the old size: a late viewer would see them garbled.
    this.output.clear();
    this.screen?.resize(cols, rows);
    try {
      this.pty?.resize(cols, rows);
    } catch {
      // The process already exited (the exit handler reports it): nothing to resize.
    }
    this.resizes.emit({ ...this.currentSize });
  }

  writeInput(data: string): void {
    // The child may have exited between the check and the write; the exit handler reports that.
    if (this.ptyEnded) return;
    try {
      this.pty?.write(data);
    } catch (error) {
      if (!isBrokenPipe(error)) throw error;
    }
  }

  // ---- AgentRuntime ----

  async deliver(message: InboundMessage): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`O agente "${this.agent.name}" não está ocioso (${this.state}).`);
    }
    this.beginTurn();
    try {
      await this.inject(formatInboundMessage(message));
    } catch (error) {
      this.fail(errorMessage(error));
      throw error;
    }
  }

  protected hooks(): BridgeHooks {
    return {
      onUserPromptSubmit: () => this.onPromptSubmitted(),
      onStop: () => this.turnStopped.fire(),
    };
  }

  // ---- process ----

  protected async launch({ command, args, env, cwd }: LaunchContext): Promise<void> {
    const screen = new TerminalScreen(this.currentSize.cols, this.currentSize.rows);
    this.screen = screen;
    const pty = loadPty().spawn(command, args, {
      name: "xterm-256color",
      ...this.currentSize,
      cwd,
      env: { ...env, TERM: "xterm-256color" },
    });
    this.pty = pty;
    this.ptyEnded = false;
    guardPtyWrites(pty);
    this.exited = new Promise((resolve) => {
      pty.onExit(({ exitCode }) => {
        this.ptyEnded = true;
        resolve();
        if (!this.lifetime.signal.aborted) {
          this.fail(`O Claude Code encerrou de forma inesperada (código ${exitCode}).`);
        }
      });
    });
    pty.onData((data) => {
      this.lastOutputAt = Date.now();
      if (!this.lifetime.signal.aborted) screen.write(data);
      this.output.push(data);
      this.outputChunks.emit(data);
    });

    await this.waitUntilReady(screen);
  }

  protected async terminate(): Promise<void> {
    const pty = this.pty;
    if (pty) {
      this.ptyEnded = true;
      await killProcessTree(pty.pid, this.deps.cli.platform);
      // Waits for the exit so no process is left when `stop()` resolves.
      await settlesWithin(this.exited, 5_000);
      releasePtyHandles(pty);
    }
    this.screen?.dispose();
  }

  // ---- boot ----

  private async waitUntilReady(screen: TerminalScreen): Promise<void> {
    const answered = new Set<string>();
    let blockedSince: number | undefined;

    const ready = await waitUntil(
      () => {
        const text = screen.text();
        if (LOGIN_SCREEN.test(text)) throw new ClaudeLoginRequiredError();

        const quiet = Date.now() - this.lastOutputAt;
        const dialog = DIALOGS.find((candidate) => candidate.pattern.test(text));
        const answer = dialog && this.answerTo(dialog, text);
        // Only a dialog nobody answers for us counts as "waiting for the user".
        blockedSince = dialog && answer === undefined ? (blockedSince ?? Date.now()) : undefined;
        if (dialog) {
          if (answer && !answered.has(`${dialog.name}:${answer}`) && quiet >= 700) {
            answered.add(`${dialog.name}:${answer}`);
            this.writeInput(answer);
          }
          if (blockedSince && Date.now() - blockedSince > this.timings.userDialogTimeoutMs) {
            throw new Error(TRUST_HINT);
          }
          return false;
        }
        const footer = screen.footer();
        return footer === "free" && quiet >= this.timings.readyQuietMs;
      },
      {
        timeoutMs: this.timings.bootTimeoutMs,
        signal: this.lifetime.signal,
        pollMs: this.timings.pollMs,
      },
    );
    if (ready) return;
    if (this.lifetime.signal.aborted) {
      throw new Error(this.failureReason ?? "O agente foi encerrado antes de ficar pronto.");
    }
    throw new Error(
      `O Claude Code não chegou ao prompt em ${Math.round(this.timings.bootTimeoutMs / 1000)} s.`,
    );
  }

  private answerTo(dialog: Dialog, screenText: string): string | undefined {
    if (dialog.name !== TRUST_FOLDER) return dialog.answer;
    if (!this.options.trustWorkingDirectory) return undefined;
    // The highlighted option is "No, exit": move to "Yes" first, then confirm.
    return /❯\s*Yes/.test(screenText) ? ENTER : ARROW_DOWN;
  }

  // ---- injecting a message ----

  /**
   * Types the text, waits for it to show, presses Enter and waits for the CLI to take it: the
   * `UserPromptSubmit` hook says so, and so does a screen that went busy (the hook is the primary
   * signal, but a lost notice must not make us press Enter forever).
   */
  private async inject(text: string): Promise<void> {
    const screen = this.screen;
    const multiline = text.includes("\n");
    const submitted = this.promptSubmitted.wait();

    this.writeInput(multiline ? `${PASTE_START}${text}${PASTE_END}` : text);
    if (!(await this.waitForEcho(screen, text))) {
      throw new Error(
        "O Claude Code não mostrou na tela o texto digitado; a mensagem não foi enviada.",
      );
    }
    // An Enter right after a block of text is read as part of the paste.
    await sleep(this.timings.enterDelayMs);

    for (let attempt = 0; attempt < this.timings.maxEnterAttempts; attempt++) {
      this.writeInput("\r");
      if (await this.waitForSubmission(submitted)) return;
    }
    throw new Error(
      "O Claude Code não confirmou o recebimento da mensagem (o Enter não foi aceito).",
    );
  }

  private waitForSubmission(hook: Promise<void>): Promise<boolean> {
    const stopWatching = new AbortController();
    const byScreen = waitUntil(() => this.screen?.footer() === "busy", {
      timeoutMs: this.timings.submitConfirmMs,
      signal: stopWatching.signal,
      pollMs: this.timings.pollMs,
    });
    return Promise.race([hook.then(() => true), byScreen]).finally(() => stopWatching.abort());
  }

  /** True once the text is on screen (typed, or collapsed into a "[Pasted text]" placeholder). */
  private async waitForEcho(screen: TerminalScreen | undefined, text: string): Promise<boolean> {
    const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? "";
    const probe = firstLine.slice(0, ECHO_PROBE_CHARS);
    return waitUntil(
      () => {
        const shown = screen?.text() ?? "";
        return shown.includes(probe) || PASTE_PLACEHOLDER.test(shown);
      },
      {
        timeoutMs: this.timings.echoTimeoutMs,
        signal: this.lifetime.signal,
        pollMs: this.timings.pollMs,
      },
    );
  }

  // ---- turns ----

  /** The CLI accepted a prompt: ours (state already busy) or one the user typed in the terminal. */
  private onPromptSubmitted(): void {
    this.promptSubmitted.fire();
    if (this.state === "idle") this.beginTurn();
  }

  private beginTurn(): void {
    this.setState("busy");
    this.turnStartedAt = Date.now();
    this.turnSawBusy = false;
    void this.watchTurn();
  }

  /** Busy until the `Stop` hook (or, if it never comes, a free footer and silence), then idle. */
  private async watchTurn(): Promise<void> {
    const stopped = this.turnStopped.wait();
    const turnOver = new AbortController();
    const onLifetimeEnd = () => turnOver.abort();
    this.lifetime.signal.addEventListener("abort", onLifetimeEnd, { once: true });

    const stoppedByHook = stopped.then(() => true);
    const stoppedBySilence = waitUntil(() => this.looksFinished(), {
      timeoutMs: Infinity,
      signal: turnOver.signal,
      pollMs: this.timings.pollMs * 10,
    });
    try {
      await Promise.race([stoppedByHook, stoppedBySilence]);
    } finally {
      turnOver.abort();
      this.lifetime.signal.removeEventListener("abort", onLifetimeEnd);
    }
    if (this.lifetime.signal.aborted) return;

    // The hook is the truth; the footer only has to catch up with it.
    await waitUntil(() => this.screen?.footer() !== "busy", {
      timeoutMs: this.timings.footerConfirmMs,
      signal: this.lifetime.signal,
      pollMs: this.timings.pollMs,
    });
    if (this.state === "busy") this.setState("idle");
  }

  /**
   * Safety net for a `Stop` hook that never arrives (CLI stuck, hook blocked by a proxy...): the
   * footer showed the turn working at some point and now shows a free input box, in silence.
   */
  private looksFinished(): boolean {
    const footer = this.screen?.footer();
    if (footer === "busy") this.turnSawBusy = true;
    const quiet = Date.now() - this.lastOutputAt >= this.timings.silenceMs;
    const waited = Date.now() - this.turnStartedAt >= this.timings.hookGraceMs;
    return this.turnSawBusy && waited && quiet && footer === "free";
  }
}
