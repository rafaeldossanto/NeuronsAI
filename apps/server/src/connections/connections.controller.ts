import { RequirePermission } from "../accounts/require-permission.js";
import { spawn, type ChildProcess } from "node:child_process";
import { Controller, Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ClaudeCli, CodexCli } from "@neurons/agent-runtimes/claude";
import { z } from "zod";
import { Endpoint } from "../api/endpoint.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { MemoryError } from "../memories/memories.service.js";

const providerStatus = z.object({
  installed: z.boolean(),
  connected: z.boolean(),
  signingIn: z.boolean(),
  message: z.string(),
});

export const connectionsSchema = z.object({
  profile: z.enum(["local", "hybrid", "hosted"]),
  secretsEnabled: z.boolean(),
  claude: providerStatus,
  chatgpt: providerStatus.extend({ available: z.boolean() }),
});

type Provider = "claude" | "chatgpt";

/** What differs between the two official CLIs a subscription goes through. */
interface Cli {
  command(): { command: string; args: string[] };
  env(): Record<string, string>;
  invalidateLoginCache(): void;
  /** @throws when the CLI is not logged in with what the agent expects. */
  ensureLoggedIn(): Promise<void>;
  /** The arguments that start the official login, after those of the command. */
  readonly loginArgs: string[];
}

@Injectable()
export class ConnectionsService implements OnApplicationShutdown {
  private readonly logins = new Map<Provider, { child: ChildProcess; timer: NodeJS.Timeout }>();
  private readonly clis = new Map<Provider, Cli>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** One instance per CLI for the process: its 30 s login cache only works if it is reused. */
  private cli(provider: Provider): Cli {
    let cli = this.clis.get(provider);
    if (!cli) {
      cli = provider === "claude" ? this.claudeCli() : this.codexCli();
      this.clis.set(provider, cli);
    }
    return cli;
  }

  private claudeCli(): Cli {
    const claude = new ClaudeCli({
      ...(this.config.claudeBin && { configuredBinary: this.config.claudeBin }),
      ...(this.config.claudeCommand && { command: this.config.claudeCommand }),
    });
    return {
      command: () => claude.command(),
      env: () => claude.env(),
      invalidateLoginCache: () => claude.invalidateLoginCache(),
      ensureLoggedIn: () => claude.ensureLoggedIn(),
      loginArgs: ["auth", "login"],
    };
  }

  private codexCli(): Cli {
    const codex = new CodexCli({
      ...(this.config.codexBin && { configuredBinary: this.config.codexBin }),
      ...(this.config.codexCommand && { command: this.config.codexCommand }),
    });
    return {
      command: () => codex.command(),
      env: () => codex.env(),
      invalidateLoginCache: () => codex.invalidateLoginCache(),
      // The subscription is the point of this card: a login with an API key does not count.
      ensureLoggedIn: () => codex.ensureLoggedIn({ requireChatgpt: true }),
      loginArgs: ["login"],
    };
  }

  /** Whether the CLI is installed and logged in, asked of the CLI itself (never of its credentials file). */
  private async probe(provider: Provider) {
    let installed = false;
    let connected = false;
    if (this.config.profile === "local") {
      const cli = this.cli(provider);
      try {
        cli.command();
        installed = true;
        await cli.ensureLoggedIn();
        connected = true;
      } catch {
        /* No credentials or native error is exposed to the browser. */
      }
    }
    return { installed, connected, signingIn: this.logins.has(provider) };
  }

  async status() {
    const [claude, chatgpt] = await Promise.all([this.probe("claude"), this.probe("chatgpt")]);
    const remote = this.config.profile !== "local";
    const remoteMessage = "A conexão da assinatura é feita no computador do runner.";
    return {
      profile: this.config.profile,
      secretsEnabled: Boolean(this.config.masterKey),
      claude: {
        ...claude,
        message: remote
          ? remoteMessage
          : claude.connected
            ? "Claude Code conectado neste computador."
            : claude.installed
              ? "Conecte sua conta pelo login oficial do Claude Code."
              : "Instale o Claude Code neste computador para conectar sua assinatura.",
      },
      chatgpt: {
        available: true,
        ...chatgpt,
        message: remote
          ? remoteMessage
          : chatgpt.connected
            ? "Codex conectado à sua conta do ChatGPT neste computador."
            : chatgpt.installed
              ? "Conecte sua conta pelo login oficial do Codex (Sign in with ChatGPT)."
              : "Instale o Codex CLI (npm i -g @openai/codex) neste computador para conectar sua conta do ChatGPT.",
      },
    };
  }

  signIn(provider: Provider) {
    if (this.config.profile !== "local")
      throw new MemoryError(
        "unavailable",
        "runner_login_required",
        "Faça a conexão no aplicativo do computador do runner.",
      );
    if (this.logins.has(provider)) return { started: true };
    const cli = this.cli(provider);
    let command;
    try {
      command = cli.command();
    } catch {
      throw provider === "claude"
        ? new MemoryError(
            "unavailable",
            "claude_not_installed",
            "Instale o Claude Code antes de conectar sua conta.",
          )
        : new MemoryError(
            "unavailable",
            "codex_not_installed",
            "Instale o Codex CLI (npm i -g @openai/codex) antes de conectar sua conta do ChatGPT.",
          );
    }
    const child = spawn(command.command, [...command.args, ...cli.loginArgs], {
      env: cli.env(),
      stdio: "ignore",
      windowsHide: true,
    });
    const clear = () => {
      const current = this.logins.get(provider);
      if (current?.child === child) {
        clearTimeout(current.timer);
        this.logins.delete(provider);
      }
      cli.invalidateLoginCache();
    };
    const timer = setTimeout(() => {
      child.kill();
      clear();
    }, 5 * 60_000);
    timer.unref();
    this.logins.set(provider, { child, timer });
    child.once("exit", clear);
    child.once("error", clear);
    return { started: true };
  }

  onApplicationShutdown() {
    for (const { child, timer } of this.logins.values()) {
      child.kill();
      clearTimeout(timer);
    }
    this.logins.clear();
  }
}

@RequirePermission("manage_credentials")
@Controller("connections")
export class ConnectionsController {
  constructor(@Inject(ConnectionsService) private readonly service: ConnectionsService) {}
  @Endpoint({
    method: "get",
    path: "",
    summary: "Estado das conexões de IA sem expor credenciais.",
    response: connectionsSchema,
  })
  status() {
    return this.service.status();
  }
  @Endpoint({
    method: "post",
    path: "claude/login",
    summary: "Abre o login oficial do Claude Code no computador local.",
    response: z.object({ started: z.boolean() }),
    errors: [503],
  })
  signIn() {
    return this.service.signIn("claude");
  }
  @Endpoint({
    method: "post",
    path: "chatgpt/login",
    summary: "Abre o login oficial do Codex CLI (conta do ChatGPT) no computador local.",
    response: z.object({ started: z.boolean() }),
    errors: [503],
  })
  signInChatgpt() {
    return this.service.signIn("chatgpt");
  }
}
