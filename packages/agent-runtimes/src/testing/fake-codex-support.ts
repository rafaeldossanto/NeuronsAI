import { fileURLToPath } from "node:url";
import { neuronsServerEntry } from "@neurons/mcp-neurons";
import { CodexCli, type CodexCliOptions } from "../codex/codex-cli.js";
import type { CodexRuntimeDeps } from "../codex/codex-runtime-base.js";
import { readHostEnvironment, type HostEnvironment } from "../platform/host-environment.js";
import { RecordingLogger } from "./fake-claude-support.js";

const FAKE_CODEX = fileURLToPath(new URL("../../test-fixtures/fake-codex.mjs", import.meta.url));

/** The fake CLI as a {@link CodexCliOptions.command}: Node running the script, with fake flags. */
export const fakeCodexCommand = (...fakeFlags: string[]) => ({
  command: process.execPath,
  args: [FAKE_CODEX, ...fakeFlags],
});

export interface CodexTestDepsOptions {
  fakeFlags?: string[];
  host?: HostEnvironment;
  askTimeoutMs?: number;
  usageFlushMs?: number;
  apiKey?: string;
  requireChatgpt?: boolean;
  cli?: CodexCliOptions;
}

/** Runtime dependencies wired to the fake Codex CLI and the real `neurons` MCP server. */
export function codexTestDeps(
  options: CodexTestDepsOptions = {},
): CodexRuntimeDeps & { logger: RecordingLogger } {
  const logger = new RecordingLogger();
  return {
    cli: new CodexCli({
      command: fakeCodexCommand(...(options.fakeFlags ?? [])),
      host: options.host ?? readHostEnvironment(),
      ...options.cli,
    }),
    requireChatgpt: options.requireChatgpt ?? true,
    ...(options.apiKey && { apiKey: options.apiKey }),
    mcpServer: { command: process.execPath, args: [neuronsServerEntry()] },
    askTimeoutMs: options.askTimeoutMs ?? 5_000,
    ...(options.usageFlushMs !== undefined && { usageFlushMs: options.usageFlushMs }),
    logger,
  };
}
