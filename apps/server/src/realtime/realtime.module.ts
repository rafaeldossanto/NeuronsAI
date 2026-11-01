import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DrizzleRunEventHistory } from "./drizzle-run-event-history.js";
import { RUN_EVENT_HISTORY } from "./run-event-history.js";
import { RunEventsGateway } from "./run-events.gateway.js";
import { RunSubscriptions } from "./run-subscriptions.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    RunEventsGateway,
    RunSubscriptions,
    { provide: RUN_EVENT_HISTORY, useClass: DrizzleRunEventHistory },
  ],
  // The Hub publishes through RunSubscriptions.
  exports: [RunSubscriptions],
})
export class RealtimeModule {}
