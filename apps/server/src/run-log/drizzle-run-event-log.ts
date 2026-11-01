import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { RunEvent } from "../realtime/run-event.js";
import { appendEvents } from "./drizzle-event-writer.js";
import type { RunEventDraft } from "./run-event-draft.js";
import type { RunEventLog } from "./run-event-log.js";

@Injectable()
export class DrizzleRunEventLog implements RunEventLog {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  append(runId: string, drafts: RunEventDraft[]): Promise<RunEvent[]> {
    return this.database.db.transaction((tx) => appendEvents(tx, runId, drafts));
  }
}
