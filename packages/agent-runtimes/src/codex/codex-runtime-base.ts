import type { AgentNode } from "@neurons/graph-schema";
import { BRIDGE_ROUTES } from "@neurons/mcp-neurons";
import type { LocalBridge } from "../bridge/local-bridge.js";
import {
  CliRuntimeBase,
  type CliAgentConfig,
  type CliRuntimeDeps,
  type SessionInvocation,
  type TerminalRuntimeNode,
} from "../cli/cli-runtime-base.js";
import type { AgentCommunication } from "../contract/agent-communication.js";
import { PrivateDirectory } from "../platform/private-directory.js";
import { BRIDGE_ENV_NAMES, assertAllowedCodexArgs, buildCodexArgs } from "./codex-args.js";
import type { CodexArgsInput } from "./codex-args.js";
import type { CodexCli } from "./codex-cli.js";

/** What the Codex runtimes share and the factory provides once. */
export interface CodexRuntimeDeps extends CliRuntimeDeps {
  cli: CodexCli;
  /** `access: "subscription"`: the login must be the ChatGPT one, not an API key. */
  requireChatgpt: boolean;
}

export type CodexAgentConfig = CliAgentConfig;

export function codexAgentConfig(agent: AgentNode, runtime: TerminalRuntimeNode): CodexAgentConfig {
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
 * What both Codex runtimes have in common: its login, its flags and the MCP server handed over with
 * `-c`. Nothing of the user's `~/.codex` is read or written; the login is the CLI's own.
 */
export abstract class CodexRuntimeBase extends CliRuntimeBase {
  declare protected readonly deps: CodexRuntimeDeps;
  /** What the arguments are built from; `exec` builds them again per turn (the thread to resume). */
  protected argsInput: CodexArgsInput | undefined;
  private bridgeEnv: Record<string, string> = {};

  constructor(agent: CodexAgentConfig, communication: AgentCommunication, deps: CodexRuntimeDeps) {
    super(agent, communication, deps);
    assertAllowedCodexArgs(agent.name, agent.args);
  }

  protected assertLoggedIn(): Promise<void> {
    return this.deps.cli.ensureLoggedIn({ requireChatgpt: this.deps.requireChatgpt });
  }

  /** The program Codex runs at the end of a turn (PTY only); `undefined` when the mode has none. */
  protected notifyProgram(bridge: LocalBridge): Promise<string[] | undefined> {
    void bridge;
    return Promise.resolve(undefined);
  }

  protected async openSession({
    briefing,
    bridge,
  }: {
    briefing: string;
    bridge: LocalBridge;
  }): Promise<SessionInvocation> {
    const notify = await this.notifyProgram(bridge);
    const input: CodexArgsInput = {
      mode: this.mode,
      briefing,
      mcpServer: this.deps.mcpServer,
      askTimeoutMs: this.deps.askTimeoutMs,
      ...(notify && { notify }),
      effort: this.agent.effort,
      ...(this.agent.model && { model: this.agent.model }),
      userArgs: this.agent.args,
    };
    this.argsInput = input;
    this.bridgeEnv = {
      NEURONS_BRIDGE_URL: bridge.url,
      NEURONS_BRIDGE_TOKEN: bridge.token,
      NEURONS_ASK_TIMEOUT_MS: String(this.deps.askTimeoutMs),
    };
    return { args: buildCodexArgs(input), env: this.childEnv() };
  }

  /**
   * The CLI's environment: the system minimum, the bridge for the MCP server (it forwards them by
   * name with `env_vars`) and, for an API-key agent, the key of this process only (`CODEX_API_KEY`).
   */
  protected childEnv(): Record<string, string> {
    return this.deps.cli.env({
      ...this.bridgeEnv,
      ...(this.deps.apiKey && { CODEX_API_KEY: this.deps.apiKey }),
      // The notify program is run by the CLI itself, so an Electron host needs this here.
      ...(this.deps.mcpServer.env?.["ELECTRON_RUN_AS_NODE"] && {
        ELECTRON_RUN_AS_NODE: this.deps.mcpServer.env["ELECTRON_RUN_AS_NODE"],
      }),
    });
  }
}

export { BRIDGE_ENV_NAMES };

/**
 * The program `notify` runs when Codex finishes a turn: a Node script in a private folder (it holds
 * the bridge token) that tells the bridge's `stop` route. It is the TUI's end-of-turn signal, as the
 * `Stop` hook is for Claude Code.
 */
export async function writeNotifyScript(
  bridge: LocalBridge,
  mcpServer: { command: string },
): Promise<{ directory: PrivateDirectory; program: string[] }> {
  const directory = await PrivateDirectory.create("neurons-codex-");
  try {
    const script = await directory.write(
      "notify.mjs",
      [
        "// Run by Codex at the end of a turn: forwards it to the Neurons bridge.",
        "let type;",
        "try { type = JSON.parse(process.argv.at(-1) ?? '{}').type; } catch {}",
        "if (type === undefined || type === 'agent-turn-complete') {",
        `  await fetch(${JSON.stringify(`${bridge.url}${BRIDGE_ROUTES.hooks.stop}`)}, {`,
        "    method: 'POST',",
        `    headers: { 'content-type': 'application/json', authorization: ${JSON.stringify(`Bearer ${bridge.token}`)} },`,
        "    body: '{}',",
        "  }).catch(() => undefined);",
        "}",
        "",
      ].join("\n"),
    );
    return { directory, program: [mcpServer.command, script] };
  } catch (error) {
    await directory.remove();
    throw error;
  }
}
