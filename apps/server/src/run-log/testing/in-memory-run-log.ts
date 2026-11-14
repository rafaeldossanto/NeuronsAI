import { randomUUID } from "node:crypto";
import type { GraphVersionRepository } from "../../graphs/graph-version-repository.js";
import { totalsByAgent, type UsageTotals } from "../../guards/usage-totals.js";
import type { RunEventHistory } from "../../realtime/run-event-history.js";
import type { RunEvent } from "../../realtime/run-event.js";
import { resourceScope } from "../../accounts/resource-scope.js";
import type { Recorded, RunEventDraft } from "../run-event-draft.js";
import { DAY_MS, assertRunQuota, type RunQuotas } from "../run-quota.js";
import type { RunEventLog } from "../run-event-log.js";
import type {
  ActiveRun,
  FinalRunStatus,
  RunListFilter,
  RunListItem,
  RunListPage,
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

  usageByAgent(runId: string): Promise<Record<string, UsageTotals>> {
    return Promise.resolve(totalsByAgent(this.eventsOf(runId, "UsageRecorded")));
  }

  eventsOf(runId: string, type?: string): RunEvent[] {
    return this.events.filter(
      (event) => event.runId === runId && (type === undefined || event.type === type),
    );
  }

  createRunning(
    graphVersionId: string,
    eventsFor: (run: RunRecord) => RunEventDraft[],
    options: { budgetUsd?: number; quotas?: RunQuotas } = {},
  ): Promise<Recorded<RunRecord>> {
    if (options.quotas && resourceScope.current().organizationId !== null) {
      // Synchronous from the check to the insert, so parallel starts line up as they do on the database.
      const since = Date.now() - DAY_MS;
      const all = [...this.runs.values()];
      try {
        assertRunQuota(
          {
            active: all.filter((run) => run.status === "pending" || run.status === "running")
              .length,
            startedInLastDay: all.filter((run) => run.startedAt && run.startedAt.getTime() >= since)
              .length,
          },
          options.quotas,
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
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

  async findSummary(runId: string): Promise<RunSummaryRecord | undefined> {
    const run = this.runs.get(runId);
    const version = run && (await this.versions.findById(run.graphVersionId));
    return run && version && { ...run, graphId: version.graphId };
  }

  async list(filter: RunListFilter): Promise<RunListPage> {
    const matching: RunListItem[] = [];
    for (const run of this.runs.values()) {
      const version = await this.versions.findById(run.graphVersionId);
      if (!version) continue;
      if (filter.status && run.status !== filter.status) continue;
      if (filter.graphId && version.graphId !== filter.graphId) continue;
      if (filter.graphVersionId && run.graphVersionId !== filter.graphVersionId) continue;
      const started = run.startedAt?.getTime();
      if (filter.from && (started === undefined || started < filter.from.getTime())) continue;
      if (filter.to && (started === undefined || started > filter.to.getTime())) continue;
      const usage = this.events.filter((e) => e.runId === run.id && e.type === "UsageRecorded");
      let costUsd = 0;
      let unknownCostTurns = 0;
      for (const event of usage) {
        const cost = (event.payload as { costUsd?: number | null }).costUsd;
        if (typeof cost === "number") costUsd += cost;
        else unknownCostTurns++;
      }
      if (filter.minCostUsd !== undefined && costUsd < filter.minCostUsd) continue;
      if (filter.maxCostUsd !== undefined && costUsd > filter.maxCostUsd) continue;
      matching.push({
        ...run,
        graphId: version.graphId,
        graphName: "",
        graphVersion: version.version,
        costUsd,
        turns: usage.length,
        unknownCostTurns,
      });
    }
    const sign = filter.order === "asc" ? 1 : -1;
    const duration = (item: RunListItem) =>
      item.startedAt && item.finishedAt
        ? item.finishedAt.getTime() - item.startedAt.getTime()
        : undefined;
    const key = (item: RunListItem) =>
      filter.sort === "costUsd" ? item.costUsd : (item.startedAt?.getTime() ?? 0);
    matching.reverse().sort((a, b) => {
      if (filter.sort === "durationMs") {
        const [x, y] = [duration(a), duration(b)];
        // No duration: last, whichever the direction.
        if (x === undefined || y === undefined)
          return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
        return sign * (x - y) || 0;
      }
      return sign * (key(a) - key(b)) || 0;
    });
    return {
      items: matching.slice(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit),
      total: matching.length,
    };
  }

  countEvents(runId: string): Promise<number> {
    return Promise.resolve(this.events.filter((event) => event.runId === runId).length);
  }

  async listRunning(): Promise<ActiveRun[]> {
    const active: ActiveRun[] = [];
    for (const run of this.runs.values()) {
      if (run.status !== "running") continue;
      const version = await this.versions.findById(run.graphVersionId);
      if (version)
        active.push({
          run,
          graph: version.definition,
          credentialsApproved: version.credentialsApproved,
        });
    }
    return active;
  }
}
