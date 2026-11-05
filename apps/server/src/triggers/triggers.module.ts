import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { GraphsModule } from "../graphs/graphs.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import { RunsModule } from "../runs/runs.module.js";
import { SecretsModule } from "../secrets/secrets.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DrizzleTriggerStateRepository } from "./drizzle-trigger-state.repository.js";
import { HooksServer } from "./hooks-server.js";
import { TRIGGER_STATE_REPOSITORY } from "./trigger-state.js";
import { TriggerLauncher } from "./trigger-launcher.js";
import { TriggerScheduler } from "./trigger-scheduler.js";
import { TriggersController } from "./triggers.controller.js";
import { TriggersService } from "./triggers.service.js";
import { HOOKS_CONFIG, WebhookService } from "./webhook.service.js";
import { DEFAULT_HOOKS_RATE_PER_MIN } from "../shared/config/hooks-config.js";

/**
 * External triggers: the webhook (on its own port, see {@link HooksServer}) and the scheduler.
 * They start runs, so this belongs with the worker side.
 */
@Module({
  imports: [DatabaseModule, GraphsModule, RunsModule, RunLogModule, SecretsModule],
  controllers: [TriggersController],
  providers: [
    { provide: TRIGGER_STATE_REPOSITORY, useClass: DrizzleTriggerStateRepository },
    {
      provide: HOOKS_CONFIG,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.hooks ?? { ratePerMinute: DEFAULT_HOOKS_RATE_PER_MIN },
    },
    TriggerLauncher,
    TriggersService,
    WebhookService,
    HooksServer,
    TriggerScheduler,
  ],
})
export class TriggersModule {}
