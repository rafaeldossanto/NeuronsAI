import { Module } from "@nestjs/common";
import { modelProviders } from "./model-providers.js";
import { RemoteRuntimeFactory } from "../runners/remote-runtime-factory.js";
import { RunnerRegistry } from "../runners/runner-registry.js";
import { RunnersModule } from "../runners/runners.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { AGENT_RUNTIME_FACTORY, RoutingAgentRuntimeFactory } from "./agent-runtime-factory.js";
import { ApiRuntimeFactory } from "./api-runtime.js";
import { SecretsModule } from "../secrets/secrets.module.js";
import { SecretsService } from "../secrets/secrets.service.js";

/** On top of a runner's own wait for the closing turn: killing the process tree and answering. */
const STOP_MARGIN_MS = 20_000;

/**
 * Where the runtime factories plug in. Agents of the `terminal` kind (T08) run in a runner,
 * embedded or remote, chosen by the profile (T24); the API runtime (T07) will run here.
 */
@Module({
  imports: [RunnersModule, SecretsModule],
  providers: [
    {
      provide: AGENT_RUNTIME_FACTORY,
      useFactory: (config: AppConfig, runners: RunnerRegistry, secrets: SecretsService) =>
        new RoutingAgentRuntimeFactory({
          api: new ApiRuntimeFactory({
            resolveSecret: (name) => secrets.get(name),
            providers: modelProviders(config),
          }),
          terminal: new RemoteRuntimeFactory(runners, {
            resolveSecret: (name) => secrets.get(name),
            settings: { askTimeoutMs: config.askTimeoutMs, usageFlushMs: config.usageFlushMs },
            stopWaitMs: config.usageFlushMs + STOP_MARGIN_MS,
          }),
        }),
      inject: [APP_CONFIG, RunnerRegistry, SecretsService],
    },
  ],
  exports: [AGENT_RUNTIME_FACTORY],
})
export class AgentsModule {}
