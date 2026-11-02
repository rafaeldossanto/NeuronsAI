import { Logger, Module } from "@nestjs/common";
import { TerminalRuntimeFactory } from "@neurons/agent-runtimes/claude";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { AGENT_RUNTIME_FACTORY, RoutingAgentRuntimeFactory } from "./agent-runtime-factory.js";

/** Where the runtime factories plug in: terminal (T08) today, API (T07) next. */
@Module({
  providers: [
    {
      provide: AGENT_RUNTIME_FACTORY,
      useFactory: (config: AppConfig) => {
        const logger = new Logger("AgentRuntime");
        return new RoutingAgentRuntimeFactory({
          terminal: new TerminalRuntimeFactory({
            askTimeoutMs: config.askTimeoutMs,
            cli: { ...(config.claudeBin && { configuredBinary: config.claudeBin }) },
            logger: { warn: (m) => logger.warn(m), error: (m) => logger.error(m) },
          }),
        });
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [AGENT_RUNTIME_FACTORY],
})
export class AgentsModule {}
