import { Inject, Injectable } from "@nestjs/common";
import type { RunEvent } from "../realtime/run-event.js";
import type { RunEventDraft } from "./run-event-draft.js";
import { RUN_EVENT_LOG, type RunEventLog } from "./run-event-log.js";
import { RUN_EVENT_PUBLISHER, type RunEventPublisher } from "./run-event-publisher.js";

/** Stores events and publishes them; publishing always happens after the commit. */
@Injectable()
export class RunEventRecorder {
  constructor(
    @Inject(RUN_EVENT_LOG) private readonly log: RunEventLog,
    @Inject(RUN_EVENT_PUBLISHER) private readonly publisher: RunEventPublisher,
  ) {}

  async record(runId: string, drafts: RunEventDraft[]): Promise<RunEvent[]> {
    const events = await this.log.append(runId, drafts);
    this.publish(events);
    return events;
  }

  /** For events already committed by a repository together with its own change. */
  publish(events: RunEvent[]): void {
    for (const event of events) this.publisher.publish(event);
  }
}
