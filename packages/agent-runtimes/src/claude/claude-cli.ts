import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { buildChildEnv } from "../platform/child-env.js";
import { findClaudeBinary, type FileProbe } from "../platform/claude-binary.js";
import { readHostEnvironment, type HostEnvironment } from "../platform/host-environment.js";

const run = promisify(execFile);

const PROBE_TIMEOUT_MS = 30_000;
const LOGIN_CACHE_MS = 30_000;

/** What to execute to get the Claude Code CLI: the program and the arguments that precede ours. */
export interface ClaudeCommand {
  command: string;
  args: string[];
}

export class ClaudeLoginRequiredError extends Error {
  constructor() {
    super(
      "O Claude Code não está com login feito neste computador. Abra um terminal, rode `claude auth login` e inicie a execução de novo.",
    );
    this.name = "ClaudeLoginRequiredError";
  }
}

export interface ClaudeCliOptions {
  /** `NEURONS_CLAUDE_BIN`. */
  configuredBinary?: string;
  /** Skips the binary lookup (tests, or a runner that knows where the CLI is). */
  command?: ClaudeCommand;
  host?: HostEnvironment;
  platform?: NodeJS.Platform;
  homeDir?: string;
  files?: FileProbe;
}

/**
 * Everything the runtimes need to know about the installed CLI, in one place: where it is, the
 * environment it runs with, whether the user is logged in and which flags it understands.
 */
export class ClaudeCli {
  readonly platform: NodeJS.Platform;
  readonly host: HostEnvironment;
  private resolved: ClaudeCommand | undefined;
  private helpText: Promise<string> | undefined;
  private loginCheckedAt = 0;

  constructor(private readonly options: ClaudeCliOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.host = options.host ?? readHostEnvironment();
  }

  /** @throws ClaudeBinaryNotFoundError */
  command(): ClaudeCommand {
    this.resolved ??= this.options.command ?? {
      command: findClaudeBinary(this.options.configuredBinary, {
        platform: this.platform,
        host: this.host,
        homeDir: this.options.homeDir ?? os.homedir(),
        ...(this.options.files && { files: this.options.files }),
      }),
      args: [],
    };
    return this.resolved;
  }

  /** The CLI's environment: the system minimum plus what the runtime asks for. */
  env(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return buildChildEnv({ host: this.host, platform: this.platform, extra });
  }

  /** @throws ClaudeLoginRequiredError when `claude auth status` says nobody is logged in. */
  async ensureLoggedIn(): Promise<void> {
    if (Date.now() - this.loginCheckedAt < LOGIN_CACHE_MS) return;
    const output = await this.capture(["auth", "status"]);
    if (!isLoggedIn(output)) throw new ClaudeLoginRequiredError();
    this.loginCheckedAt = Date.now();
  }

  /** Forgets the cached login (e.g. right after `claude auth login` ends) so the next check asks the CLI. */
  invalidateLoginCache(): void {
    this.loginCheckedAt = 0;
  }

  /** Whether `claude --help` lists the flag (the CLI changes between versions). */
  async supportsFlag(flag: string): Promise<boolean> {
    this.helpText ??= this.capture(["--help"]);
    return (await this.helpText).includes(flag);
  }

  /** stdout of a short CLI command; a non-zero exit still returns what it printed. */
  private async capture(args: string[]): Promise<string> {
    const { command, args: prefix } = this.command();
    try {
      const { stdout } = await run(command, [...prefix, ...args], {
        env: this.env(),
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      const stdout = (error as { stdout?: unknown }).stdout;
      return typeof stdout === "string" ? stdout : "";
    }
  }
}

function isLoggedIn(statusOutput: string): boolean {
  try {
    return (JSON.parse(statusOutput) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}
