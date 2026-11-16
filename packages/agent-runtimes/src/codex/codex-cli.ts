import { execFile } from "node:child_process";
import os from "node:os";
import type { AgentCliHandle } from "../cli/cli-runtime-base.js";
import { buildChildEnv } from "../platform/child-env.js";
import { realFiles, type FileProbe } from "../platform/claude-binary.js";
import { codexLaunchFor, findCodexBinary, type CodexCommand } from "../platform/codex-binary.js";
import { readHostEnvironment, type HostEnvironment } from "../platform/host-environment.js";

export type { CodexCommand };

const PROBE_TIMEOUT_MS = 30_000;
const LOGIN_CACHE_MS = 30_000;

/** How the CLI says it is logged in, as far as `codex login status` lets us tell. */
export type CodexLoginMethod = "chatgpt" | "api-key" | "unknown";

export interface CodexLoginStatus {
  loggedIn: boolean;
  method: CodexLoginMethod;
}

export class CodexLoginRequiredError extends Error {
  constructor() {
    super(
      "O Codex CLI não está com login feito neste computador. Abra um terminal, rode `codex login` (Sign in with ChatGPT) e inicie a execução de novo.",
    );
    this.name = "CodexLoginRequiredError";
  }
}

/** The CLI is logged in, but with an API key, and the agent asked for the ChatGPT subscription. */
export class CodexWrongLoginError extends Error {
  constructor() {
    super(
      "O Codex CLI está logado com uma chave de API, mas o agente usa a assinatura do ChatGPT. Rode `codex logout` e depois `codex login` escolhendo Sign in with ChatGPT.",
    );
    this.name = "CodexWrongLoginError";
  }
}

export interface CodexCliOptions {
  /** `NEURONS_CODEX_BIN`. */
  configuredBinary?: string;
  /** Skips the binary lookup (tests, or a runner that knows where the CLI is). */
  command?: CodexCommand;
  host?: HostEnvironment;
  platform?: NodeJS.Platform;
  homeDir?: string;
  files?: FileProbe;
}

interface Captured {
  code: number | null;
  output: string;
}

/**
 * Everything the runtimes need to know about the installed Codex CLI, in one place: where it is,
 * the environment it runs with, whether the user is logged in and how to log in. The login is only
 * ever asked of the CLI itself (`codex login status`); the credentials file is never opened.
 */
export class CodexCli implements AgentCliHandle {
  readonly platform: NodeJS.Platform;
  readonly host: HostEnvironment;
  private resolved: CodexCommand | undefined;
  private loginCheckedAt = 0;

  constructor(private readonly options: CodexCliOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.host = options.host ?? readHostEnvironment();
  }

  /** @throws CodexBinaryNotFoundError */
  command(): CodexCommand {
    this.resolved ??= this.options.command ?? this.locate();
    return this.resolved;
  }

  /** The CLI's environment: the system minimum plus what the runtime asks for. */
  env(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return buildChildEnv({ host: this.host, platform: this.platform, extra });
  }

  /** What to run in a terminal for the user to log in: the official `codex login` (browser, ChatGPT). */
  loginCommand(): CodexCommand {
    const { command, args } = this.command();
    return { command, args: [...args, "login"] };
  }

  /** Asks `codex login status`; a missing or failing CLI counts as "not logged in". */
  async loginStatus(): Promise<CodexLoginStatus> {
    const { code, output } = await this.capture(["login", "status"]);
    if (code !== 0) return { loggedIn: false, method: "unknown" };
    const method: CodexLoginMethod = /chatgpt/i.test(output)
      ? "chatgpt"
      : /api[ -]?key/i.test(output)
        ? "api-key"
        : "unknown";
    return { loggedIn: true, method };
  }

  /**
   * @throws CodexLoginRequiredError when `codex login status` says nobody is logged in
   * @throws CodexWrongLoginError when `requireChatgpt` and the login is an API key
   */
  async ensureLoggedIn(options: { requireChatgpt?: boolean } = {}): Promise<void> {
    if (Date.now() - this.loginCheckedAt < LOGIN_CACHE_MS) return;
    const status = await this.loginStatus();
    if (!status.loggedIn) throw new CodexLoginRequiredError();
    if (options.requireChatgpt && status.method === "api-key") throw new CodexWrongLoginError();
    this.loginCheckedAt = Date.now();
  }

  /** Forgets the cached login (e.g. right after `codex login` ends) so the next check asks the CLI. */
  invalidateLoginCache(): void {
    this.loginCheckedAt = 0;
  }

  private locate(): CodexCommand {
    const lookup = {
      platform: this.platform,
      host: this.host,
      homeDir: this.options.homeDir ?? os.homedir(),
      files: this.options.files ?? realFiles,
    };
    return codexLaunchFor(findCodexBinary(this.options.configuredBinary, lookup), lookup);
  }

  /** Output (stdout and stderr) and exit code of a short CLI command. */
  private capture(args: string[]): Promise<Captured> {
    const { command, args: prefix } = this.command();
    return new Promise((resolve) => {
      execFile(
        command,
        [...prefix, ...args],
        { env: this.env(), timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof (error as { code?: unknown }).code === "number"
                ? (error as { code: number }).code
                : null;
          resolve({ code, output: `${stdout}\n${stderr}` });
        },
      );
    });
  }
}
