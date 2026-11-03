import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { RunnerHost, terminalFactoryProvider } from "@neurons/runner";
import { createMemoryChannelPair } from "@neurons/runner-protocol";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { RunnerRegistry } from "./runner-registry.js";

/** The identity of the runner that lives in this process. */
export const EMBEDDED_RUNNER = { id: "embedded", name: "este computador" } as const;

/**
 * Profile `local`: the runner runs inside the server's process and talks to it through the same
 * protocol as a remote one, over an in-memory channel. So a run behaves the same wherever its
 * agents are; only the profile changes.
 */
@Injectable()
export class EmbeddedRunner implements OnModuleInit, OnApplicationShutdown {
  private host: RunnerHost | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RunnerRegistry) private readonly registry: RunnerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.config.profile !== "local") return;
    const logger = new Logger("EmbeddedRunner");
    const runtimeLogger = {
      warn: (m: string) => logger.warn(m),
      error: (m: string) => logger.error(m),
    };
    const host = new RunnerHost({
      name: EMBEDDED_RUNNER.name,
      platform: process.platform,
      logger: runtimeLogger,
      createFactory: terminalFactoryProvider({
        ...(this.config.claudeBin && { claudeBin: this.config.claudeBin }),
        ...(this.config.claudeCommand && { claudeCommand: this.config.claudeCommand }),
        logger: runtimeLogger,
      }),
    });
    const { server, runner } = createMemoryChannelPair();
    this.registry.accept(EMBEDDED_RUNNER, server);
    host.attach(runner);
    this.host = host;
  }

  /** Safety net: the Supervisor already stopped the agents, this makes sure none is left behind. */
  async onApplicationShutdown(): Promise<void> {
    await this.host?.stopAll();
  }
}
