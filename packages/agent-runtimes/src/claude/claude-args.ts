import { COMMUNICATION_TOOLS, mcpToolName } from "@neurons/mcp-neurons";
import { UnsupportedRuntimeError } from "../contract/agent-runtime-factory.js";

/** Flags the runtime sets itself, or that would switch the permission model off. */
const RESERVED_FLAGS = [
  "-p",
  "--print",
  "--input-format",
  "--output-format",
  "--settings",
  "--setting-sources",
  "--mcp-config",
  "--strict-mcp-config",
  "--allowedTools",
  "--allowed-tools",
  "--append-system-prompt-file",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
];

const flagName = (arg: string): string => arg.split("=")[0] ?? arg;

/** True when the list passes the flag, either as `--flag value` or `--flag=value`. */
export const hasFlag = (args: readonly string[], flag: string): boolean =>
  args.some((arg) => flagName(arg) === flag);

function valueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => flagName(arg) === flag);
  if (index < 0) return undefined;
  const inline = args[index]?.split("=").slice(1).join("=");
  return inline || args[index + 1];
}

/**
 * The `--permission-mode` values the Claude Code CLI lists in `claude --help`, checked against
 * version 2.1.321 (choices: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan). Left out
 * on purpose: `bypassPermissions` (turns the permission model off) and `default`, which older CLIs
 * accepted but 2.1.321 no longer lists (it is `manual` now). Recheck when the CLI is upgraded.
 */
const ALLOWED_PERMISSION_MODES: readonly string[] = [
  "manual",
  "acceptEdits",
  "plan",
  "dontAsk",
  "auto",
];

/**
 * The agent's own `args` (from the graph) are passed to the CLI after ours. Anything that would
 * undo what the runtime sets up, or bypass permissions, is refused before the agent starts.
 */
export function assertAllowedUserArgs(agentName: string, args: readonly string[]): void {
  const refuse = (flag: string): never => {
    throw new UnsupportedRuntimeError(
      `O agente "${agentName}" usa o argumento "${flag}", que o Neurons não permite (ele controla esse ajuste e nunca desliga as permissões do Claude Code).`,
    );
  };
  for (const arg of args) {
    if (RESERVED_FLAGS.includes(flagName(arg))) refuse(flagName(arg));
  }
  if (args.filter((arg) => flagName(arg) === "--permission-mode").length > 1)
    refuse("--permission-mode");
  const permissionMode = valueOf(args, "--permission-mode");
  if (
    hasFlag(args, "--permission-mode") &&
    !ALLOWED_PERMISSION_MODES.includes(permissionMode ?? "")
  )
    refuse("--permission-mode");
}

export interface ClaudeArgsInput {
  mode: "pty" | "stream-json";
  mcpConfigFile: string;
  briefingFile: string;
  /** Only the PTY mode has hooks. */
  settingsFile?: string;
  /** `undefined` when the agent has none or the CLI has no such flag. */
  effort?: string;
  model?: string;
  maxBudgetUsd?: number;
  /** The agent's own `args`, already checked by {@link assertAllowedUserArgs}. */
  userArgs: readonly string[];
}

/** The tools pre-approved for the agent: the communication tools of the `neurons` MCP and nothing else. */
export const allowedToolNames = (): string[] => COMMUNICATION_TOOLS.map(mcpToolName);

/**
 * Builds the CLI arguments. Never touches the user's own settings: hooks and the MCP server come
 * from temporary files, only the user's project/local settings are read.
 */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  assertAllowedUserArgs("Claude", input.userArgs);
  const args =
    input.mode === "stream-json"
      ? [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          // The raw API events (`stream_event`) as the model writes: the screen shows the text grow.
          "--include-partial-messages",
          // Nobody can answer a permission prompt in a headless session: deny instead of hanging.
          "--permission-prompts",
          "none",
        ]
      : [];

  // No browser integration: it adds a first-run dialog and tools nobody asked for.
  args.push("--no-chrome", "--setting-sources", "project,local");
  // The CLI may default to "auto" (a classifier approves tools on its own): ask for the plain
  // mode, where anything not pre-approved needs a person, unless the agent's args choose one.
  if (!hasFlag(input.userArgs, "--permission-mode")) args.push("--permission-mode", "manual");
  if (input.settingsFile) args.push("--settings", input.settingsFile);
  args.push(
    "--mcp-config",
    input.mcpConfigFile,
    "--strict-mcp-config",
    "--allowedTools",
    allowedToolNames().join(","),
    "--append-system-prompt-file",
    input.briefingFile,
  );

  if (input.effort && !hasFlag(input.userArgs, "--effort")) args.push("--effort", input.effort);
  if (input.model && !hasFlag(input.userArgs, "--model")) args.push("--model", input.model);
  if (input.maxBudgetUsd && input.mode === "stream-json") {
    args.push("--max-budget-usd", String(input.maxBudgetUsd));
  }
  return [...args, ...input.userArgs];
}
