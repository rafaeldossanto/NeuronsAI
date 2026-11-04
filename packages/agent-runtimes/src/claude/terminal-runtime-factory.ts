import type { AgentNode } from "@neurons/graph-schema";
import { neuronsServerEntry } from "@neurons/mcp-neurons";
import type { AgentCommunication } from "../contract/agent-communication.js";
import type { AgentRuntime } from "../contract/agent-runtime.js";
import {
  UnsupportedRuntimeError,
  type AgentRuntimeFactory,
} from "../contract/agent-runtime-factory.js";
import { silentLogger, type RuntimeLogger } from "../contract/logger.js";
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
  /** How to start the `neurons` MCP server; defaults to this repository's `@neurons/mcp-neurons`. */
  mcpServer?: McpServerCommand;
  logger?: RuntimeLogger;
  /** PTY tuning (timings, terminal size); mostly for tests. */
  terminal?: ClaudeTerminalOptions;
}

/** Builds the runtime of `terminal` agents: today only the Claude Code CLI, as a PTY or as stream-json. */
export class TerminalRuntimeFactory implements AgentRuntimeFactory {
  private readonly deps: ClaudeRuntimeDeps;

  constructor(private readonly options: TerminalRuntimeFactoryOptions) {
    this.deps = {
      ...(options.apiKey && { apiKey: options.apiKey }),
      cli: new ClaudeCli(options.cli),
      mcpServer: options.mcpServer ?? { command: process.execPath, args: [neuronsServerEntry()] },
      askTimeoutMs: options.askTimeoutMs,
      logger: options.logger ?? silentLogger,
      ...(options.usageFlushMs !== undefined && { usageFlushMs: options.usageFlushMs }),
    };
  }

  create(agent: AgentNode, communication: AgentCommunication): AgentRuntime {
    const runtime = agent.runtime;
    if (runtime.kind !== "terminal") {
      throw new UnsupportedRuntimeError(
        `O agente "${agent.name}" usa o runtime "${runtime.kind}", que não é de terminal.`,
      );
    }
    if (runtime.cli !== "claude") {
      throw new UnsupportedRuntimeError(
        `O agente "${agent.name}" usa a CLI "${runtime.cli}", que ainda não é suportada. Por enquanto só o Claude Code (cli "claude") roda como agente de terminal.`,
      );
    }
    if (runtime.access === "api-key" && !this.options.apiKey) {
      throw new UnsupportedRuntimeError(
        "Este agente exige uma chave de API; a credencial não foi entregue pelo servidor.",
      );
    }
    return this.createClaude(agent, runtime, communication);
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
