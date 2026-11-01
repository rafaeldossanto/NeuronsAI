import { Module } from "@nestjs/common";
import { EmptyRunEventHistory, RUN_EVENT_HISTORY } from "./run-event-history.js";
import { RunEventsGateway } from "./run-events.gateway.js";
import { RunSubscriptions } from "./run-subscriptions.js";

@Module({
  providers: [
    RunEventsGateway,
    RunSubscriptions,
    { provide: RUN_EVENT_HISTORY, useClass: EmptyRunEventHistory },
  ],
  // The Hub publishes through RunSubscriptions.
  exports: [RunSubscriptions],
})
export class RealtimeModule {}
