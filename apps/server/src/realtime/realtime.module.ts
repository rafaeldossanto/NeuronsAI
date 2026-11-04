import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DrizzleRunEventHistory } from "./drizzle-run-event-history.js";
import { RUN_EVENT_HISTORY } from "./run-event-history.js";
import { RunEventsGateway } from "./run-events.gateway.js";
import { RunSubscriptions } from "./run-subscriptions.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG, TERMINAL_INPUT_LIMITS } from "../shared/config/tokens.js";
import { TerminalInput } from "./terminal-input.js";
import { TerminalSessions } from "./terminal-sessions.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    RunEventsGateway,
    RunSubscriptions,
    TerminalSessions,
    TerminalInput,
    {
      provide: TERMINAL_INPUT_LIMITS,
      useFactory: (config: AppConfig) => config.terminalInput,
      inject: [APP_CONFIG],
    },
    { provide: RUN_EVENT_HISTORY, useClass: DrizzleRunEventHistory },
  ],
  // The Hub publishes through RunSubscriptions; the Supervisor attaches terminal runtimes to TerminalSessions;
  // the history is also read by the guards and the API.
  exports: [RunSubscriptions, TerminalSessions, RUN_EVENT_HISTORY],
})
export class RealtimeModule {}
