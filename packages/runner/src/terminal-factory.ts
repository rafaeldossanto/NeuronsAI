import type { RuntimeLogger } from "@neurons/agent-runtimes";
import { TerminalRuntimeFactory, type ClaudeCommand } from "@neurons/agent-runtimes/claude";
import type { RuntimeFactoryProvider } from "./runner-host.js";

export interface TerminalFactoryOptions {
  /** `NEURONS_CLAUDE_BIN`: empty means "find the Claude Code CLI". */
  claudeBin?: string;
  /** What to run as the CLI, program and leading arguments (tests and demos point it at a fake). */
  claudeCommand?: ClaudeCommand;
  logger?: RuntimeLogger;
}

/** The runtimes a runner hosts today: the Claude Code CLI as a terminal or as stream-json. */
export function terminalFactoryProvider(
  options: TerminalFactoryOptions = {},
): RuntimeFactoryProvider {
  return (settings) =>
    new TerminalRuntimeFactory({
      askTimeoutMs: settings.askTimeoutMs,
      usageFlushMs: settings.usageFlushMs,
      cli: {
        ...(options.claudeBin && { configuredBinary: options.claudeBin }),
        ...(options.claudeCommand && { command: options.claudeCommand }),
      },
      ...(options.logger && { logger: options.logger }),
    });
}
