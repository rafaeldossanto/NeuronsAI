import { RequirePermission } from "../accounts/require-permission.js";
import { spawn, type ChildProcess } from "node:child_process";
import { Controller, Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ClaudeCli } from "@neurons/agent-runtimes/claude";
import { z } from "zod";
import { Endpoint } from "../api/endpoint.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { MemoryError } from "../memories/memories.service.js";

export const connectionsSchema = z.object({
  profile: z.enum(["local", "hybrid", "hosted"]),
  secretsEnabled: z.boolean(),
  claude: z.object({
    installed: z.boolean(),
    connected: z.boolean(),
    signingIn: z.boolean(),
    message: z.string(),
  }),
  chatgpt: z.object({ available: z.boolean(), message: z.string() }),
});

@Injectable()
export class ConnectionsService implements OnApplicationShutdown {
  private login: ChildProcess | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private claudeCli: ClaudeCli | undefined;

  /** One instance for the process: its 30 s login cache only works if it is reused. */
  private cli() {
    this.claudeCli ??= new ClaudeCli({
      ...(this.config.claudeBin && { configuredBinary: this.config.claudeBin }),
      ...(this.config.claudeCommand && { command: this.config.claudeCommand }),
    });
    return this.claudeCli;
  }

  async status() {
    let installed = false;
    let connected = false;
    if (this.config.profile === "local") {
      const cli = this.cli();
      try {
        cli.command();
        installed = true;
        await cli.ensureLoggedIn();
        connected = true;
      } catch {
        /* No credentials or native error is exposed to the browser. */
      }
    }
    return {
      profile: this.config.profile,
      secretsEnabled: Boolean(this.config.masterKey),
      claude: {
        installed,
        connected,
        signingIn: Boolean(this.login),
        message:
          this.config.profile !== "local"
            ? "A conexão da assinatura é feita no computador do runner."
            : connected
              ? "Claude Code conectado neste computador."
              : installed
                ? "Conecte sua conta pelo login oficial do Claude Code."
                : "Instale o Claude Code neste computador para conectar sua assinatura.",
      },
      chatgpt: {
        available: false,
        message:
          "A integração oficial com a assinatura do ChatGPT ainda não está disponível no NeuronsAI. Você pode usar uma chave da API OpenAI.",
      },
    };
  }

  signIn() {
    if (this.config.profile !== "local")
      throw new MemoryError(
        "unavailable",
        "runner_login_required",
        "Faça a conexão no aplicativo do computador do runner.",
      );
    if (this.login) return { started: true };
    const cli = this.cli();
    let command;
    try {
      command = cli.command();
    } catch {
      throw new MemoryError(
        "unavailable",
        "claude_not_installed",
        "Instale o Claude Code antes de conectar sua conta.",
      );
    }
    const child = spawn(command.command, [...command.args, "auth", "login"], {
      env: cli.env(),
      stdio: "ignore",
      windowsHide: true,
    });
    this.login = child;
    const clear = () => {
      if (this.login === child) this.login = undefined;
      clearTimeout(this.timer);
      cli.invalidateLoginCache();
    };
    child.once("exit", clear);
    child.once("error", clear);
    this.timer = setTimeout(() => {
      child.kill();
      clear();
    }, 5 * 60_000);
    this.timer.unref();
    return { started: true };
  }

  onApplicationShutdown() {
    this.login?.kill();
    clearTimeout(this.timer);
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
    return this.service.signIn();
  }
}
