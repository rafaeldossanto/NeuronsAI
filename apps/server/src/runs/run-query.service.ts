import { Inject, Injectable } from "@nestjs/common";
import { sumOf, type UsageTotals } from "../guards/usage-totals.js";
import type { MessageRecord } from "../hub/message.js";
import { MESSAGE_STORE, type MessageStore } from "../hub/message-store.js";
import { RUN_EVENT_HISTORY, type RunEventHistory } from "../realtime/run-event-history.js";
import type { RunEvent } from "../realtime/run-event.js";
import { RunNotFoundError } from "../run-log/run-log.errors.js";
import {
  RUN_REPOSITORY,
  type RunListFilter,
  type RunListPage,
  type RunRepository,
  type RunSummaryRecord,
} from "../run-log/run-repository.js";
import type { RunFinishDetails, RunFinishReason } from "./run-lifecycle-events.js";

export interface RunFinishView extends RunFinishDetails {
  reason: RunFinishReason;
  at: Date;
}

/** A run with what its log says about it. */
export interface RunDetailView {
  run: RunSummaryRecord;
  input: string;
  finish: RunFinishView | null;
  usage: { total: UsageTotals; byAgent: Record<string, UsageTotals> };
}

/** The read side of the runs: everything the API shows about them comes from the database. */
@Injectable()
export class RunQueryService {
  constructor(
    @Inject(RUN_REPOSITORY) private readonly runs: RunRepository,
    @Inject(RUN_EVENT_HISTORY) private readonly history: RunEventHistory,
    @Inject(MESSAGE_STORE) private readonly messages: MessageStore,
  ) {}

  list(filter: RunListFilter): Promise<RunListPage> {
    return this.runs.list(filter);
  }

  /** @throws RunNotFoundError */
  async require(runId: string): Promise<RunSummaryRecord> {
    const run = await this.runs.findSummary(runId);
    if (!run) throw new RunNotFoundError(runId);
    return run;
  }

  /** @throws RunNotFoundError */
  async detail(runId: string): Promise<RunDetailView> {
    const run = await this.require(runId);
    const [started, finished, byAgent] = await Promise.all([
      this.history.readByType(runId, "RunStarted"),
      this.history.readByType(runId, "RunFinished"),
      this.history.usageByAgent(runId),
    ]);
    return {
      run,
      input: (started[0]?.payload as { input?: string } | undefined)?.input ?? "",
      finish: finished[0] ? toFinish(finished[0]) : null,
      usage: { total: sumOf(Object.values(byAgent)), byAgent },
    };
  }

  /** One page of events plus how many the run has in all: one ownership check, both reads together. @throws RunNotFoundError */
  async eventsPage(
    runId: string,
    fromSeq: number,
    limit: number,
  ): Promise<{ items: RunEvent[]; total: number }> {
    await this.require(runId);
    const [items, total] = await Promise.all([
      this.history.readFrom(runId, fromSeq, limit),
      this.runs.countEvents(runId),
    ]);
    return { items, total };
  }

  /** @throws RunNotFoundError */
  async messagesOf(runId: string, afterSeq: number, limit: number): Promise<MessageRecord[]> {
    await this.require(runId);
    return this.messages.listByRun(runId, { afterSeq, limit });
  }
}

function toFinish(event: RunEvent): RunFinishView {
  const payload = event.payload as RunFinishDetails & { reason: RunFinishReason };
  const { reason, agent, result, error, guard, message } = payload;
  return {
    reason,
    at: event.at,
    ...(agent !== undefined && { agent }),
    ...(result !== undefined && { result }),
    ...(error !== undefined && { error }),
    ...(guard !== undefined && { guard }),
    ...(message !== undefined && { message }),
  };
}
