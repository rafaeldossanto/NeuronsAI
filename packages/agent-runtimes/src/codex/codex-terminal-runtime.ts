import type { IPty } from "node-pty";
import type { BridgeHooks, LocalBridge } from "../bridge/local-bridge.js";
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
import { Gate, settlesWithin, sleep, waitUntil } from "../claude/async.js";
import { errorMessage, type LaunchContext } from "../cli/cli-runtime-base.js";
import {
  DEFAULT_TERMINAL_TIMINGS,
  type ClaudeTerminalOptions,
  type TerminalTimings,
} from "../claude/claude-terminal-runtime.js";
import { formatInboundMessage } from "../claude/inbound-text.js";
import { loadPty } from "../claude/native.js";
import { DEFAULT_OUTPUT_BUFFER_CHARS, OutputBuffer } from "../claude/output-buffer.js";
import { TerminalScreen } from "../claude/terminal-screen.js";
import { CodexLoginRequiredError } from "./codex-cli.js";
import {
  CodexRuntimeBase,
  writeNotifyScript,
  type CodexAgentConfig,
  type CodexRuntimeDeps,
} from "./codex-runtime-base.js";

export type CodexTerminalOptions = ClaudeTerminalOptions;
export type { TerminalTimings };

interface Dialog {
  name: string;
  pattern: RegExp;
  /** What to type; `undefined` leaves the decision to the person watching the terminal. */
  answer: string | undefined;
}

const TRUST_FOLDER = "trust-folder";

/**
 * Screens of the Codex TUI that need a person, as the OpenAI docs and the CLI describe them (not yet
 * checked against a real run): trusting the folder and the model-migration notice. Nothing is
 * answered for the user; the boot gives up with a hint when nobody does.
 */
const DIALOGS: Dialog[] = [
  {
    name: TRUST_FOLDER,
    pattern: /trust the contents of this directory|do you trust/i,
    answer: undefined,
  },
  { name: "notice", pattern: /press enter to continue/i, answer: undefined },
];
/** The sign-in screen the TUI shows when there is no login. */
const LOGIN_SCREEN = /sign in with chatgpt|finish signing in|provide your own api key/i;
/** The status line while a turn runs: "Working (12s • esc to interrupt)". */
const BUSY_STATUS = /esc to interrupt/i;
/** An approval request: the turn is not over, it waits for a person. */
const APPROVAL_PROMPT =
  /would you like to (run|make|apply)|do you want to (approve|allow)|yes, proceed|don't ask again/i;

const TRUST_HINT =
  "O Codex está pedindo para confiar na pasta do agente. Abra o terminal do agente e responda, ou rode `codex` uma vez nessa pasta.";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_PLACEHOLDER = /\[Pasted (Content|text)/i;
const ECHO_PROBE_CHARS = 25;
const WATCH_USER_MS = 500;

/**
 * The Codex TUI in a pseudo-terminal, so a person can watch it and type into it. The end of a turn
 * comes from the `notify` program Codex runs at `agent-turn-complete` (it tells the bridge, as the
 * `Stop` hook does for Claude Code); the screen (`esc to interrupt` on the status line) confirms
 * that a message was taken, and stands in for the notice when it never arrives.
 */
export class CodexTerminalRuntime extends CodexRuntimeBase implements TerminalAgentRuntime {
  protected readonly mode = "pty";
  /** The screen of the CLI carries no structured usage. */
  readonly reportsCost = false;

  private readonly timings: TerminalTimings;
  private currentSize: TerminalSize;
  private readonly resizes = new Signal<TerminalSize>();
  private readonly output: OutputBuffer;
  private readonly outputChunks = new Signal<string>();
  private readonly turnStopped = new Gate();
  private pty: IPty | undefined;
  private ptyEnded = false;
  private screen: TerminalScreen | undefined;
  private exited: Promise<void> = Promise.resolve();
  private lastOutputAt = 0;
  private turnStartedAt = 0;
  private turnSawBusy = false;
  private userWatcher: ReturnType<typeof setInterval> | undefined;

  constructor(
    agent: CodexAgentConfig,
    communication: AgentCommunication,
    deps: CodexRuntimeDeps,
    private readonly options: CodexTerminalOptions = {},
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
    return { onStop: () => this.turnStopped.fire() };
  }

  protected override async notifyProgram(bridge: LocalBridge): Promise<string[]> {
    const { directory, program } = await writeNotifyScript(bridge, this.deps.mcpServer);
    this.adopt({ directoryPath: directory.path, dispose: () => directory.remove() });
    return program;
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
          this.fail(`O Codex encerrou de forma inesperada (código ${exitCode}).`);
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
    this.watchUserTurns();
  }

  protected async terminate(): Promise<void> {
    clearInterval(this.userWatcher);
    const pty = this.pty;
    if (pty) {
      this.ptyEnded = true;
      await killProcessTree(pty.pid, this.deps.cli.platform);
      await settlesWithin(this.exited, 5_000);
      releasePtyHandles(pty);
    }
    this.screen?.dispose();
  }

  // ---- boot ----

  private async waitUntilReady(screen: TerminalScreen): Promise<void> {
    let blockedSince: number | undefined;
    const ready = await waitUntil(
      () => {
        const text = screen.text();
        if (LOGIN_SCREEN.test(text)) throw new CodexLoginRequiredError();

        const quiet = Date.now() - this.lastOutputAt;
        const dialog = DIALOGS.find((candidate) => candidate.pattern.test(text));
        const answer = dialog && this.answerTo(dialog);
        blockedSince = dialog && answer === undefined ? (blockedSince ?? Date.now()) : undefined;
        if (dialog) {
          if (answer && quiet >= 700) this.writeInput(answer);
          if (blockedSince && Date.now() - blockedSince > this.timings.userDialogTimeoutMs) {
            throw new Error(TRUST_HINT);
          }
          return false;
        }
        // Something is on screen, nothing is running and nothing moves: the prompt is there.
        return (
          this.lastOutputAt > 0 &&
          text.trim() !== "" &&
          !BUSY_STATUS.test(text) &&
          quiet >= this.timings.readyQuietMs * 2
        );
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
      `O Codex não chegou ao prompt em ${Math.round(this.timings.bootTimeoutMs / 1000)} s.`,
    );
  }

  private answerTo(dialog: Dialog): string | undefined {
    // Trusting a folder is the user's decision (see `trustWorkingDirectory`); option 1 is "Yes".
    if (dialog.name === TRUST_FOLDER) return this.options.trustWorkingDirectory ? "1" : undefined;
    return dialog.answer;
  }

  // ---- injecting a message ----

  private isBusy(): boolean {
    return BUSY_STATUS.test(this.screen?.text() ?? "");
  }

  /** Types the text, waits for it to show, presses Enter and waits for the CLI to take it. */
  private async inject(text: string): Promise<void> {
    const screen = this.screen;
    const multiline = text.includes("\n");
    const stopped = this.turnStopped.wait();

    this.writeInput(multiline ? `${PASTE_START}${text}${PASTE_END}` : text);
    if (!(await this.waitForEcho(screen, text))) {
      throw new Error("O Codex não mostrou na tela o texto digitado; a mensagem não foi enviada.");
    }
    // An Enter right after a block of text is read as part of the paste.
    await sleep(this.timings.enterDelayMs);

    for (let attempt = 0; attempt < this.timings.maxEnterAttempts; attempt++) {
      this.writeInput("\r");
      if (await this.waitForSubmission(stopped)) return;
    }
    throw new Error("O Codex não confirmou o recebimento da mensagem (o Enter não foi aceito).");
  }

  /** Taken once the status line shows work (or the turn already ended: a very short one). */
  private waitForSubmission(stopped: Promise<void>): Promise<boolean> {
    const stopWatching = new AbortController();
    const byScreen = waitUntil(() => this.isBusy(), {
      timeoutMs: this.timings.submitConfirmMs,
      signal: stopWatching.signal,
      pollMs: this.timings.pollMs,
    });
    return Promise.race([stopped.then(() => true), byScreen]).finally(() => stopWatching.abort());
  }

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

  /** A person typing straight into the terminal also starts a turn: the screen shows it working. */
  private watchUserTurns(): void {
    this.userWatcher = setInterval(() => {
      if (this.state === "idle" && this.isBusy()) this.beginTurn();
    }, WATCH_USER_MS);
    this.userWatcher.unref();
  }

  private beginTurn(): void {
    this.setState("busy");
    this.turnStartedAt = Date.now();
    this.turnSawBusy = false;
    void this.watchTurn();
  }

  /** Busy until the `notify` program says the turn is over (or, if it never does, silence), then idle. */
  private async watchTurn(): Promise<void> {
    const stopped = this.turnStopped.wait();
    const turnOver = new AbortController();
    const onLifetimeEnd = () => turnOver.abort();
    this.lifetime.signal.addEventListener("abort", onLifetimeEnd, { once: true });

    const stoppedByNotice = stopped.then(() => true);
    const stoppedBySilence = waitUntil(() => this.looksFinished(), {
      timeoutMs: Infinity,
      signal: turnOver.signal,
      pollMs: this.timings.pollMs * 10,
    });
    try {
      await Promise.race([stoppedByNotice, stoppedBySilence]);
    } finally {
      turnOver.abort();
      this.lifetime.signal.removeEventListener("abort", onLifetimeEnd);
    }
    if (this.lifetime.signal.aborted) return;

    // The notice is the truth; the status line only has to catch up with it.
    await waitUntil(() => !this.isBusy(), {
      timeoutMs: this.timings.footerConfirmMs,
      signal: this.lifetime.signal,
      pollMs: this.timings.pollMs,
    });
    if (this.state === "busy") this.setState("idle");
  }

  /**
   * Safety net for a `notify` that never arrives: the screen showed the turn working at some point
   * and now shows nothing running and no approval request, in silence.
   */
  private looksFinished(): boolean {
    const text = this.screen?.text() ?? "";
    if (BUSY_STATUS.test(text)) this.turnSawBusy = true;
    const quiet = Date.now() - this.lastOutputAt >= this.timings.silenceMs;
    const waited = Date.now() - this.turnStartedAt >= this.timings.hookGraceMs;
    return (
      this.turnSawBusy && waited && quiet && !BUSY_STATUS.test(text) && !APPROVAL_PROMPT.test(text)
    );
  }
}
