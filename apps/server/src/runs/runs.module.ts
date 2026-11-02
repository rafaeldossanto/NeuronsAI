import { Module } from "@nestjs/common";
import { GraphsModule } from "../graphs/graphs.module.js";
import { GuardsModule } from "../guards/guards.module.js";
import { HubModule } from "../hub/hub.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { RUN_SERVICE_OPTIONS, RunService } from "./run.service.js";

@Module({
  imports: [HubModule, GuardsModule, RunLogModule, GraphsModule],
  providers: [
    RunService,
    {
      provide: RUN_SERVICE_OPTIONS,
      useFactory: (config: AppConfig) => ({
        ...(config.guards.runBudgetUsd !== undefined && {
          defaultBudgetUsd: config.guards.runBudgetUsd,
        }),
      }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [RunService],
})
export class RunsModule {}
