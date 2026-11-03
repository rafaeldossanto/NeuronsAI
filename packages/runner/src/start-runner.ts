import os from "node:os";
import type { RuntimeLogger } from "@neurons/agent-runtimes";
import type { ClaudeCommand } from "@neurons/agent-runtimes/claude";
import {
  RunnerConnection,
  type ConnectionStatus,
  type ReconnectPolicy,
} from "./runner-connection.js";
import { RunnerHost } from "./runner-host.js";
import { terminalFactoryProvider } from "./terminal-factory.js";

export interface StartRunnerOptions {
  /** `ws(s)://` address of the server's runner endpoint (see `runnerEndpoint`). */
  url: string;
  token: string;
  name?: string;
  claudeBin?: string;
  claudeCommand?: ClaudeCommand;
  reconnect?: ReconnectPolicy;
  logger?: RuntimeLogger;
  onStatus?: (status: ConnectionStatus) => void;
}

export interface RunningRunner {
  host: RunnerHost;
  connection: RunnerConnection;
  /** Closes the connection and stops every agent. */
  stop(): Promise<void>;
}

/** Hosts the terminal runtimes and connects to the server: what the `neurons-runner` program does. */
export function startRunner(options: StartRunnerOptions): RunningRunner {
  const host = new RunnerHost({
    name: options.name ?? os.hostname(),
    platform: process.platform,
    createFactory: terminalFactoryProvider({
      ...(options.claudeBin && { claudeBin: options.claudeBin }),
      ...(options.claudeCommand && { claudeCommand: options.claudeCommand }),
      ...(options.logger && { logger: options.logger }),
    }),
    ...(options.logger && { logger: options.logger }),
  });
  const connection = new RunnerConnection({
    url: options.url,
    token: options.token,
    host,
    ...(options.reconnect && { reconnect: options.reconnect }),
    ...(options.onStatus && { onStatus: options.onStatus }),
  });
  connection.start();
  return {
    host,
    connection,
    stop: async () => {
      connection.stop();
      await host.stopAll();
    },
  };
}
