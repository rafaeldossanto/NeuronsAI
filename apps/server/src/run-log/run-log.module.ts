import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RunSubscriptions } from "../realtime/run-subscriptions.js";
import { DrizzleRunEventLog } from "./drizzle-run-event-log.js";
import { DrizzleRunRepository } from "./drizzle-run.repository.js";
import { RUN_EVENT_LOG } from "./run-event-log.js";
import { RUN_EVENT_PUBLISHER } from "./run-event-publisher.js";
import { RunEventRecorder } from "./run-event-recorder.js";
import { RUN_REPOSITORY } from "./run-repository.js";

/** Persistence of runs and of their event log, plus publishing to the realtime gateway. */
@Module({
  imports: [DatabaseModule, RealtimeModule],
  providers: [
    RunEventRecorder,
    { provide: RUN_EVENT_LOG, useClass: DrizzleRunEventLog },
    { provide: RUN_REPOSITORY, useClass: DrizzleRunRepository },
    { provide: RUN_EVENT_PUBLISHER, useExisting: RunSubscriptions },
  ],
  exports: [RunEventRecorder, RUN_EVENT_LOG, RUN_REPOSITORY],
})
export class RunLogModule {}
