import { MCP_SERVER_NAME } from "@neurons/mcp-neurons";
import { UnsupportedRuntimeError } from "../contract/agent-runtime-factory.js";
import type { McpServerCommand } from "../claude/session-files.js";
import { MCP_TOOL_TIMEOUT_MARGIN_MS } from "../claude/session-files.js";

/** The variables that carry the bridge address and token to the `neurons` MCP server (never argv). */
export const BRIDGE_ENV_NAMES = [
  "NEURONS_BRIDGE_URL",
  "NEURONS_BRIDGE_TOKEN",
  "NEURONS_ASK_TIMEOUT_MS",
] as const;

/**
 * Flags the runtime sets itself, or that would widen what the agent may do (the permission model is
 * the runtime's: read-only sandbox, and nothing that turns approvals or the sandbox off).
 */
const RESERVED_FLAGS = [
  "--json",
  "--experimental-json",
  "--output-last-message",
  "-o",
  "--output-schema",
  "--ephemeral",
  "--config",
  "-c",
  "--profile",
  "-p",
  "--cd",
  "-C",
  "--add-dir",
  "--ask-for-approval",
  "-a",
  "--approve-for-me",
  "--not-so-yolo",
  "--full-auto",
  "--yolo",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--enable",
  "--disable",
  "--remote",
  "--remote-auth-token-env",
  "--oss",
  "--local-provider",
  "--search",
  "--worktree",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
];

/** `--sandbox` values the agent's own args may choose: never the one that switches the sandbox off. */
const ALLOWED_SANDBOXES: readonly string[] = ["read-only", "workspace-write"];

const flagName = (arg: string): string => arg.split("=")[0] ?? arg;

/** True when the list passes the flag, either as `--flag value` or `--flag=value`. */
export const hasCodexFlag = (args: readonly string[], ...flags: string[]): boolean =>
  args.some((arg) => flags.includes(flagName(arg)));

function valueOf(args: readonly string[], ...flags: string[]): string | undefined {
  const index = args.findIndex((arg) => flags.includes(flagName(arg)));
  if (index < 0) return undefined;
  const inline = args[index]?.split("=").slice(1).join("=");
  return inline || args[index + 1];
}

/**
 * The agent's own `args` (from the graph) are passed to the CLI after ours. Anything that would
 * undo what the runtime sets up, or open the sandbox, is refused before the agent starts.
 */
export function assertAllowedCodexArgs(agentName: string, args: readonly string[]): void {
  const refuse = (flag: string): never => {
    throw new UnsupportedRuntimeError(
      `O agente "${agentName}" usa o argumento "${flag}", que o Neurons não permite (ele controla esse ajuste e nunca desliga o sandbox nem as aprovações do Codex).`,
    );
  };
  for (const arg of args) {
    if (RESERVED_FLAGS.includes(flagName(arg))) refuse(flagName(arg));
  }
  if (args.filter((arg) => ["--sandbox", "-s"].includes(flagName(arg))).length > 1)
    refuse("--sandbox");
  if (hasCodexFlag(args, "--sandbox", "-s")) {
    if (!ALLOWED_SANDBOXES.includes(valueOf(args, "--sandbox", "-s") ?? "")) refuse("--sandbox");
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A TOML basic string (what `-c key="value"` needs). JSON escapes are valid TOML ones, but for DEL and lone surrogates. */
export function tomlString(value: string): string {
  return JSON.stringify(value.replace(LONE_SURROGATE, "�")).replaceAll("\u007f", "\\u007f");
}

const tomlArray = (values: readonly string[]): string => `[${values.map(tomlString).join(",")}]`;

const tomlInlineTable = (entries: Readonly<Record<string, string>>): string =>
  `{${Object.entries(entries)
    .map(([key, value]) => `${tomlString(key)}=${tomlString(value)}`)
    .join(",")}}`;

/** Characters of the briefing the command line can carry (Windows allows about 32 000 for the whole line). */
export const MAX_BRIEFING_CHARS = 16_000;

/** Codex's reasoning effort for ours: the highest levels only exist on some models, so they stay at "high". */
export const codexEffort = (effort: string): string =>
  effort === "xhigh" || effort === "max" ? "high" : effort;

export interface CodexArgsInput {
  mode: "pty" | "stream-json";
  briefing: string;
  mcpServer: McpServerCommand;
  askTimeoutMs: number;
  /** PTY only: the program Codex runs when a turn ends (`notify`). */
  notify?: readonly string[];
  effort?: string;
  model?: string;
  /** stream-json only: the thread to continue; the first turn has none. */
  resumeThreadId?: string;
  /** The agent's own `args`, already checked by {@link assertAllowedCodexArgs}. */
  userArgs: readonly string[];
}

/**
 * Builds the CLI arguments. Never touches the user's own `~/.codex`: the MCP server, the briefing and
 * the sandbox come from `-c`/flags of this one run, and the login is the CLI's own.
 *
 * The sandbox is read-only and nothing is approved by default: the `neurons` MCP tools are the only
 * thing pre-approved, which is what the Claude agent gets too (`--permission-mode manual` plus
 * `--allowedTools`). The PTY lets a person answer the CLI's approval prompts on the terminal;
 * `exec` cannot ask anyone, so it never asks (`approval_policy="never"`: what is not allowed fails).
 */
export function buildCodexArgs(input: CodexArgsInput): string[] {
  assertAllowedCodexArgs("Codex", input.userArgs);
  if (input.briefing.length > MAX_BRIEFING_CHARS) {
    throw new UnsupportedRuntimeError(
      `As instruções do agente têm ${input.briefing.length} caracteres; o Codex aceita até ${MAX_BRIEFING_CHARS} pela linha de comando. Reduza o texto.`,
    );
  }

  const server = `mcp_servers.${MCP_SERVER_NAME}`;
  const config: string[] = [
    `${server}.command=${tomlString(input.mcpServer.command)}`,
    `${server}.args=${tomlArray(input.mcpServer.args)}`,
    ...(input.mcpServer.env && Object.keys(input.mcpServer.env).length > 0
      ? [`${server}.env=${tomlInlineTable(input.mcpServer.env)}`]
      : []),
    // The bridge address and token are read from the CLI's own environment, never from argv.
    `${server}.env_vars=${tomlArray(BRIDGE_ENV_NAMES)}`,
    // Without the Neurons tools the agent cannot talk to anyone: better to stop than to run deaf.
    `${server}.required=true`,
    `${server}.startup_timeout_sec=30`,
    `${server}.tool_timeout_sec=${Math.ceil((input.askTimeoutMs + MCP_TOOL_TIMEOUT_MARGIN_MS) / 1000)}`,
    `${server}.default_tools_approval_mode=${tomlString("approve")}`,
    `developer_instructions=${tomlString(input.briefing)}`,
  ];
  if (input.effort) config.push(`model_reasoning_effort=${tomlString(codexEffort(input.effort))}`);

  const sandbox = hasCodexFlag(input.userArgs, "--sandbox", "-s") ? [] : ["--sandbox", "read-only"];
  const model =
    input.model && !hasCodexFlag(input.userArgs, "--model", "-m") ? ["--model", input.model] : [];

  if (input.mode === "pty") {
    if (input.notify) config.push(`notify=${tomlArray(input.notify)}`);
    // The CLI asks before the first TUI frame whether to update: nobody is there to answer.
    config.push("check_for_update_on_startup=false");
    return [
      ...sandbox,
      "--ask-for-approval",
      "on-request",
      ...model,
      ...config.flatMap((entry) => ["-c", entry]),
      ...input.userArgs,
    ];
  }

  config.push(`approval_policy=${tomlString("never")}`);
  return [
    "exec",
    "--json",
    // The folder is the user's own choice, git or not.
    "--skip-git-repo-check",
    ...sandbox,
    ...model,
    ...config.flatMap((entry) => ["-c", entry]),
    ...input.userArgs,
    ...(input.resumeThreadId ? ["resume", input.resumeThreadId] : []),
    // The message goes through stdin: no size limit, no quoting.
    "-",
  ];
}
