import type { AgentNode } from "@neurons/graph-schema";
import type { LocalBridge } from "../bridge/local-bridge.js";
import type { AgentCommunication } from "../contract/agent-communication.js";
import {
  CliRuntimeBase,
  errorMessage,
  type CliAgentConfig,
  type CliRuntimeDeps,
  type LaunchContext,
  type SessionInvocation,
  type TerminalRuntimeNode,
} from "../cli/cli-runtime-base.js";
import { assertAllowedUserArgs, buildClaudeArgs } from "./claude-args.js";
import type { ClaudeCli } from "./claude-cli.js";
import { MCP_TOOL_TIMEOUT_MARGIN_MS, SessionFiles } from "./session-files.js";

export { errorMessage, type LaunchContext, type TerminalRuntimeNode };

/** What the runtimes share and the factory provides once. */
export interface ClaudeRuntimeDeps extends CliRuntimeDeps {
  cli: ClaudeCli;
}

/** The part of the graph node the Claude runtimes read. */
export type ClaudeAgentConfig = CliAgentConfig;

export function claudeAgentConfig(
  agent: AgentNode,
  runtime: TerminalRuntimeNode,
): ClaudeAgentConfig {
  return {
    name: agent.name,
    cwd: runtime.cwd,
    args: runtime.args,
    effort: agent.effort,
    ...(runtime.model && { model: runtime.model }),
    ...(agent.budgetUsd !== undefined && { budgetUsd: agent.budgetUsd }),
  };
}

/**
 * What both Claude runtimes have in common: its login, its flags and the files it reads (`--settings`,
 * `--mcp-config`, the briefing). The subclasses only start the process and decide when a turn is over.
 */
export abstract class ClaudeRuntimeBase extends CliRuntimeBase {
  declare protected readonly deps: ClaudeRuntimeDeps;

  constructor(
    agent: ClaudeAgentConfig,
    communication: AgentCommunication,
    deps: ClaudeRuntimeDeps,
  ) {
    super(agent, communication, deps);
    assertAllowedUserArgs(agent.name, agent.args);
  }

  protected assertLoggedIn(): Promise<void> {
    return this.deps.cli.ensureLoggedIn();
  }

  protected async openSession({
    briefing,
    bridge,
  }: {
    briefing: string;
    bridge: LocalBridge;
  }): Promise<SessionInvocation> {
    const { cli } = this.deps;
    const files = await SessionFiles.create({
      bridgeUrl: bridge.url,
      bridgeToken: bridge.token,
      mcpServer: this.deps.mcpServer,
      askTimeoutMs: this.deps.askTimeoutMs,
      briefing,
      withHooks: true,
    });
    this.adopt(files);

    const args = buildClaudeArgs({
      mode: this.mode,
      mcpConfigFile: files.mcpConfigFile,
      briefingFile: files.briefingFile,
      ...(files.settingsFile && { settingsFile: files.settingsFile }),
      ...(await this.supportedEffort()),
      ...(this.agent.model && { model: this.agent.model }),
      ...(this.agent.budgetUsd !== undefined && { maxBudgetUsd: this.agent.budgetUsd }),
      userArgs: this.agent.args,
    });
    const env = cli.env({
      ...(this.deps.apiKey && { ANTHROPIC_API_KEY: this.deps.apiKey }),
      // Hard per-call limit of every MCP tool: must outlive the Hub's `ask` timeout.
      MCP_TOOL_TIMEOUT: String(this.deps.askTimeoutMs + MCP_TOOL_TIMEOUT_MARGIN_MS),
    });
    return { args, env };
  }

  private async supportedEffort(): Promise<{ effort: string } | Record<string, never>> {
    if (await this.deps.cli.supportsFlag("--effort")) return { effort: this.agent.effort };
    this.deps.logger.warn(
      `O Claude Code instalado não tem a opção --effort: o esforço "${this.agent.effort}" do agente "${this.agent.name}" será ignorado.`,
    );
    return {};
  }
}
