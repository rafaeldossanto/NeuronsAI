import type { AgentNode } from "@neurons/graph-schema";
import { neuronsServerEntry } from "@neurons/mcp-neurons";
import type { AgentCommunication } from "../contract/agent-communication.js";
import type { AgentRuntime } from "../contract/agent-runtime.js";
import {
  UnsupportedRuntimeError,
  type AgentRuntimeFactory,
} from "../contract/agent-runtime-factory.js";
import { silentLogger, type RuntimeLogger } from "../contract/logger.js";
import { CodexCli, type CodexCliOptions } from "../codex/codex-cli.js";
import { CodexExecRuntime } from "../codex/codex-exec-runtime.js";
import { codexAgentConfig, type CodexRuntimeDeps } from "../codex/codex-runtime-base.js";
import { CodexTerminalRuntime } from "../codex/codex-terminal-runtime.js";
import { ClaudeCli, type ClaudeCliOptions } from "./claude-cli.js";
import {
  claudeAgentConfig,
  type ClaudeRuntimeDeps,
  type TerminalRuntimeNode,
} from "./claude-runtime-base.js";
import { ClaudeStreamJsonRuntime } from "./claude-stream-json-runtime.js";
import { ClaudeTerminalRuntime, type ClaudeTerminalOptions } from "./claude-terminal-runtime.js";
import type { McpServerCommand } from "./session-files.js";

export interface TerminalRuntimeFactoryOptions {
  apiKey?: string;
  /** The Hub's `ask` timeout; the CLI's MCP tool timeout follows it. */
  askTimeoutMs: number;
  /** How long `stop` waits for a turn under way to report its usage; defaults to `DEFAULT_USAGE_FLUSH_MS`. */
  usageFlushMs?: number;
  /** Where the CLI is and how it is found (`NEURONS_CLAUDE_BIN` goes in `configuredBinary`). */
  cli?: ClaudeCliOptions;
  /** Where the Codex CLI is and how it is found (`NEURONS_CODEX_BIN` goes in `configuredBinary`). */
  codex?: CodexCliOptions;
  /** How to start the `neurons` MCP server; defaults to this repository's `@neurons/mcp-neurons`. */
  mcpServer?: McpServerCommand;
  logger?: RuntimeLogger;
  /** PTY tuning (timings, terminal size); mostly for tests. */
  terminal?: ClaudeTerminalOptions;
}

/** Builds the runtime of `terminal` agents: the Claude Code CLI or the Codex CLI, as a PTY or as stream-json. */
export class TerminalRuntimeFactory implements AgentRuntimeFactory {
  private readonly deps: ClaudeRuntimeDeps;
  private readonly codexCli: CodexCli;

  constructor(private readonly options: TerminalRuntimeFactoryOptions) {
    this.deps = {
      ...(options.apiKey && { apiKey: options.apiKey }),
      cli: new ClaudeCli(options.cli),
      mcpServer: options.mcpServer ?? { command: process.execPath, args: [neuronsServerEntry()] },
      askTimeoutMs: options.askTimeoutMs,
      logger: options.logger ?? silentLogger,
      ...(options.usageFlushMs !== undefined && { usageFlushMs: options.usageFlushMs }),
    };
    this.codexCli = new CodexCli(options.codex);
  }

  create(agent: AgentNode, communication: AgentCommunication): AgentRuntime {
    const runtime = agent.runtime;
    if (runtime.kind !== "terminal") {
      throw new UnsupportedRuntimeError(
        `O agente "${agent.name}" usa o runtime "${runtime.kind}", que não é de terminal.`,
      );
    }
    if (runtime.cli !== "claude" && runtime.cli !== "codex") {
      throw new UnsupportedRuntimeError(
        `O agente "${agent.name}" usa a CLI "${runtime.cli}", que ainda não é suportada. Por enquanto só o Claude Code (cli "claude") e o Codex (cli "codex") rodam como agente de terminal.`,
      );
    }
    if (runtime.access === "api-key" && !this.options.apiKey) {
      throw new UnsupportedRuntimeError(
        "Este agente exige uma chave de API; a credencial não foi entregue pelo servidor.",
      );
    }
    return runtime.cli === "codex"
      ? this.createCodex(agent, runtime, communication)
      : this.createClaude(agent, runtime, communication);
  }

  private createCodex(
    agent: AgentNode,
    runtime: TerminalRuntimeNode,
    communication: AgentCommunication,
  ): AgentRuntime {
    // The CLI takes a key from its environment only in `codex exec`; the TUI would have to write it
    // to its own login file, which the Neurons never does.
    if (this.options.apiKey && runtime.mode !== "stream-json") {
      throw new UnsupportedRuntimeError(
        `O agente "${agent.name}" usa chave de API no Codex, e o Codex só aceita a chave pelo ambiente no modo stream-json. Troque o modo do agente ou use a assinatura do ChatGPT.`,
      );
    }
    const deps: CodexRuntimeDeps = {
      ...this.deps,
      cli: this.codexCli,
      requireChatgpt: runtime.access !== "api-key",
    };
    const config = codexAgentConfig(agent, runtime);
    return runtime.mode === "stream-json"
      ? new CodexExecRuntime(config, communication, deps)
      : new CodexTerminalRuntime(config, communication, deps, this.options.terminal);
  }

  private createClaude(
    agent: AgentNode,
    runtime: TerminalRuntimeNode,
    communication: AgentCommunication,
  ): AgentRuntime {
    const config = claudeAgentConfig(agent, runtime);
    return runtime.mode === "stream-json"
      ? new ClaudeStreamJsonRuntime(config, communication, this.deps)
      : new ClaudeTerminalRuntime(config, communication, this.deps, this.options.terminal);
  }
}
