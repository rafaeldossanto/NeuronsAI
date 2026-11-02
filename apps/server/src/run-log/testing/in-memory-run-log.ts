import { randomUUID } from "node:crypto";
import type { GraphVersionRepository } from "../../graphs/graph-version-repository.js";
import type { RunEventHistory } from "../../realtime/run-event-history.js";
import type { RunEvent } from "../../realtime/run-event.js";
import type { Recorded, RunEventDraft } from "../run-event-draft.js";
import type { RunEventLog } from "../run-event-log.js";
import type {
  ActiveRun,
  FinalRunStatus,
  RunListFilter,
  RunRecord,
  RunRepository,
  RunSummaryRecord,
} from "../run-repository.js";

/** Runs and their event log in memory, with the same seq rules as the database. */
export class InMemoryRunLog implements RunEventLog, RunRepository, RunEventHistory {
  readonly events: RunEvent[] = [];
  private readonly runs = new Map<string, RunRecord>();
  private readonly lastSeq = new Map<string, number>();

  constructor(private readonly versions: GraphVersionRepository) {}

  /** Reserves `count` consecutive seqs; returns the first. */
  allocateSeqs(runId: string, count: number): number {
    const last = this.lastSeq.get(runId) ?? 0;
    this.lastSeq.set(runId, last + count);
    return last + 1;
  }

  append(runId: string, drafts: RunEventDraft[]): Promise<RunEvent[]> {
    return Promise.resolve(this.insert(runId, this.allocateSeqs(runId, drafts.length), drafts));
  }

  /** Stores the drafts at seqs reserved earlier with {@link allocateSeqs}. */
  insert(runId: string, firstSeq: number, drafts: RunEventDraft[]): RunEvent[] {
    const stored = drafts.map((draft, index): RunEvent => ({
      runId,
      seq: firstSeq + index,
      type: draft.type,
      agent: draft.agent ?? null,
      payload: draft.payload,
      at: new Date(),
    }));
    this.events.push(...stored);
    return stored;
  }

  readFrom(runId: string, fromSeq: number, limit?: number): Promise<RunEvent[]> {
    const events = this.eventsOf(runId)
      .filter((event) => event.seq >= fromSeq)
      .sort((a, b) => a.seq - b.seq);
    return Promise.resolve(limit === undefined ? events : events.slice(0, limit));
  }

  readByType(runId: string, type: string): Promise<RunEvent[]> {
    return Promise.resolve(this.eventsOf(runId, type).sort((a, b) => a.seq - b.seq));
  }

  eventsOf(runId: string, type?: string): RunEvent[] {
    return this.events.filter(
      (event) => event.runId === runId && (type === undefined || event.type === type),
    );
  }

  createRunning(
    graphVersionId: string,
    eventsFor: (run: RunRecord) => RunEventDraft[],
    options: { budgetUsd?: number } = {},
  ): Promise<Recorded<RunRecord>> {
    const record: RunRecord = {
      id: randomUUID(),
      graphVersionId,
      status: "running",
      budgetUsd: options.budgetUsd ?? null,
      startedAt: new Date(),
      finishedAt: null,
    };
    this.runs.set(record.id, record);
    return this.append(record.id, eventsFor(record)).then((events) => ({ record, events }));
  }

  finish(
    runId: string,
    status: FinalRunStatus,
    events: RunEventDraft[],
  ): Promise<Recorded<RunRecord> | undefined> {
    const run = this.runs.get(runId);
    if (run?.status !== "running") return Promise.resolve(undefined);
    const record = { ...run, status, finishedAt: new Date() };
    this.runs.set(runId, record);
    return Promise.resolve({
      record,
      events: this.insert(runId, this.allocateSeqs(runId, events.length), events),
    });
  }

  findById(runId: string): Promise<RunRecord | undefined> {
    return Promise.resolve(this.runs.get(runId));
  }

  async list(filter: RunListFilter): Promise<RunSummaryRecord[]> {
    const summaries: RunSummaryRecord[] = [];
    for (const run of this.runs.values()) {
      const version = await this.versions.findById(run.graphVersionId);
      if (!version) continue;
      if (filter.status && run.status !== filter.status) continue;
      if (filter.graphId && version.graphId !== filter.graphId) continue;
      summaries.push({ ...run, graphId: version.graphId });
    }
    return summaries.reverse().slice(0, filter.limit);
  }

  async listRunning(): Promise<ActiveRun[]> {
    const active: ActiveRun[] = [];
    for (const run of this.runs.values()) {
      if (run.status !== "running") continue;
      const version = await this.versions.findById(run.graphVersionId);
      if (version) active.push({ run, graph: version.definition });
    }
    return active;
  }
}
