import type {
  ConnectionStatus,
  RunningRunner,
  StartRunnerOptions,
  runnerEndpoint,
} from "@neurons/runner";
import { RunnerIssueError, type RunnerApi } from "./runner-api.js";
import type { RunnerMode, RunnerTokenMode } from "./runner-mode.js";
import type { DesktopRunnerStore, StoredRunner } from "./runner-store.js";

export type RunnerRuntimeOptions = Pick<
  StartRunnerOptions,
  "claudeBin" | "claudeCommand" | "codexBin" | "codexCommand"
>;

/** What the menu shows: never a token. */
export interface RunnerView {
  /** Only a remote server has a runner choice. */
  remote: boolean;
  mode: RunnerMode;
  status: string;
}

interface Options {
  mode: RunnerMode;
  saveMode: (mode: RunnerMode) => Promise<void>;
  store: Pick<DesktopRunnerStore, "load" | "save" | "clear">;
  api: Pick<RunnerApi, "issue" | "revoke">;
  start: (options: StartRunnerOptions) => RunningRunner;
  endpoint: typeof runnerEndpoint;
  runtime: RunnerRuntimeOptions;
  hostname: () => string;
  /** The view changed (menu to redraw). */
  onChange: () => void;
}

interface Held {
  origin: string;
  mode: RunnerTokenMode;
  /** Set once the runner is up; absent while only the token is held (start failed). */
  runner?: RunningRunner;
}

const OFF = "Desligado";

/**
 * Keeps this computer's runner in line with the app: on while a remote server is open and the mode
 * is Personal or Organization, off otherwise. Tokens come from the server's own endpoints, live
 * only in the OS-protected store and in the runner, and are taken back when the runner is turned
 * off on purpose. Everything runs one step at a time, in the order it was asked.
 */
export class DesktopRunnerManager {
  private mode: RunnerMode;
  private origin: string | null = null;
  private status = OFF;
  private held: Held | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: Options) {
    this.mode = options.mode;
  }

  view(): RunnerView {
    return { remote: this.origin !== null, mode: this.mode, status: this.status };
  }

  /** The person chose a mode in the menu. */
  setMode(mode: RunnerMode): Promise<void> {
    return this.enqueue(async () => {
      if (mode === this.mode) return;
      this.mode = mode;
      await this.options.saveMode(mode).catch(() => undefined);
      await this.reconcile();
    });
  }

  /** The app now shows this remote server (`origin`), or the local space / no account (`null`). */
  remoteChanged(origin: string | null): Promise<void> {
    return this.enqueue(async () => {
      this.origin = origin;
      await this.reconcile();
    });
  }

  /** The app is closing: stops the runner and its agents. The token stays for the next opening. */
  close(): Promise<void> {
    return this.enqueue(async () => {
      const runner = this.held?.runner;
      if (this.held) this.held.runner = undefined;
      await runner?.stop();
    });
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    const next = this.queue.then(step, step);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private setStatus(status: string): void {
    this.status = status;
    this.options.onChange();
  }

  private async reconcile(): Promise<void> {
    const wanted =
      this.origin !== null && this.mode !== "off" ? { origin: this.origin, mode: this.mode } : null;
    const held = this.held;
    if (held && (!wanted || held.origin !== wanted.origin || held.mode !== wanted.mode))
      await this.release(held);
    if (!wanted) {
      this.setStatus(OFF);
      return;
    }
    if (this.held) return;
    await this.acquire(wanted.origin, wanted.mode);
  }

  /** Turned off on purpose: stop, take the token back (without blocking if that fails), forget it. */
  private async release(held: Held): Promise<void> {
    if (this.held === held) this.held = undefined;
    await held.runner?.stop().catch(() => undefined);
    try {
      const stored = await this.options.store.load(held.origin, held.mode);
      if (stored) await this.options.api.revoke(stored).catch(() => undefined);
    } catch {
      // No readable token, nothing to take back.
    }
    await this.options.store.clear(held.origin, held.mode).catch(() => undefined);
  }

  private async acquire(origin: string, mode: RunnerTokenMode): Promise<void> {
    this.setStatus("Conectando…");
    let stored: StoredRunner | undefined;
    try {
      stored = await this.options.store.load(origin, mode);
      if (!stored) {
        const name = (this.options.hostname() || "NeuronsAI").slice(0, 100);
        const issued = await this.options.api.issue(origin, mode, name);
        stored = { serverOrigin: origin, mode, ...issued };
        await this.options.store.save(stored);
      }
    } catch (error) {
      this.setStatus(this.issueMessage(error, mode));
      return;
    }
    const held: Held = { origin, mode };
    this.held = held;
    try {
      held.runner = this.options.start({
        url: this.options.endpoint(origin),
        token: stored.token,
        name: stored.name,
        ...this.options.runtime,
        onStatus: (status) => this.onRunnerStatus(held, status),
      });
    } catch {
      this.held = undefined;
      this.setStatus("Não foi possível iniciar o runner deste computador.");
    }
  }

  private issueMessage(error: unknown, mode: RunnerTokenMode): string {
    if (error instanceof RunnerIssueError) {
      switch (error.kind) {
        case "signed-out":
          return "Entre na sua conta para ligar o runner deste computador.";
        case "forbidden":
          return mode === "organization"
            ? "Só owner/admin colocam este computador na organização"
            : "Seu perfil não pode ligar um runner pessoal neste servidor.";
        case "conflict":
          return `Já existe um runner da organização chamado ${this.options.hostname().slice(0, 100)}. Revogue o antigo na tela Runners.`;
      }
    }
    return "Não foi possível preparar o runner deste computador.";
  }

  private onRunnerStatus(held: Held, status: ConnectionStatus): void {
    if (this.held !== held) return; // a runner already replaced or turned off
    switch (status.kind) {
      case "connecting":
      case "disconnected":
        this.setStatus("Conectando…");
        return;
      case "connected": {
        const name = this.options.hostname().slice(0, 100);
        void this.options.store
          .load(held.origin, held.mode)
          .then((stored) => this.setStatus(`Conectado como ${stored?.name ?? name}`))
          .catch(() => this.setStatus(`Conectado como ${name}`));
        return;
      }
      case "refused":
        if (status.code === "unauthorized") void this.enqueue(() => this.revokedOnTheWeb(held));
        else this.setStatus(status.message || "O servidor recusou o runner deste computador.");
    }
  }

  /** The server no longer knows this token: someone revoked it on purpose, so never ask for another. */
  private async revokedOnTheWeb(held: Held): Promise<void> {
    if (this.held !== held) return;
    this.held = undefined;
    await held.runner?.stop().catch(() => undefined);
    await this.options.store.clear(held.origin, held.mode).catch(() => undefined);
    this.mode = "off";
    await this.options.saveMode("off").catch(() => undefined);
    this.setStatus("Desconectado pela web");
  }
}
