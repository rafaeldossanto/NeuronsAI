import type { RunEvent } from "../realtime/run-event.js";

export const USAGE_RECORDED = "UsageRecorded";

/** What an agent (or a whole run) consumed. */
export interface UsageTotals {
  /** Sum of the turns whose cost is known. */
  costUsd: number;
  turns: number;
  /** Turns that reported no cost. They are NOT counted as zero: `costUsd` is then a lower bound. */
  unknownCostTurns: number;
}

const empty = (): UsageTotals => ({ costUsd: 0, turns: 0, unknownCostTurns: 0 });

export function sumOf(all: Iterable<UsageTotals>): UsageTotals {
  const sum = empty();
  for (const item of all) {
    sum.costUsd += item.costUsd;
    sum.turns += item.turns;
    sum.unknownCostTurns += item.unknownCostTurns;
  }
  return sum;
}

/** What each agent consumed, from the `UsageRecorded` events of a run: the log is the only source of truth. */
export function totalsByAgent(events: readonly RunEvent[]): Record<string, UsageTotals> {
  const totals: Record<string, UsageTotals> = {};
  for (const event of events) {
    if (event.type !== USAGE_RECORDED || !event.agent) continue;
    const cost = (event.payload as { costUsd?: number | null }).costUsd;
    const entry = (totals[event.agent] ??= empty());
    entry.turns++;
    if (typeof cost === "number") entry.costUsd += cost;
    else entry.unknownCostTurns++;
  }
  return totals;
}
