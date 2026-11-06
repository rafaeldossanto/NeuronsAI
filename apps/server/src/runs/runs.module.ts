import { Module } from "@nestjs/common";
import { GraphsModule } from "../graphs/graphs.module.js";
import { GuardsModule } from "../guards/guards.module.js";
import { HubModule } from "../hub/hub.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { RunQueryService } from "./run-query.service.js";
import { RUN_SERVICE_OPTIONS, RunService, type RunServiceOptions } from "./run.service.js";
import { RunsController } from "./runs.controller.js";

@Module({
  imports: [HubModule, GuardsModule, RunLogModule, RealtimeModule, GraphsModule],
  controllers: [RunsController],
  providers: [
    RunService,
    RunQueryService,
    {
      provide: RUN_SERVICE_OPTIONS,
      useFactory: (config: AppConfig): RunServiceOptions => ({
        ...(config.quotas && { quotas: config.quotas }),
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
