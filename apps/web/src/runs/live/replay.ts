import { initialRunLiveState, reduceRunEvent } from "./reduce-run-event";
import type { LivePulse, RunLiveState, RunLogEvent } from "./types";

/** Longest wait kept between two events at 1×; longer silences are shortened to this. */
export const MAX_GAP_MS = 2000;
/** Shortest wait at 1×, so a burst of events with the same timestamp is still seen one by one. */
export const MIN_GAP_MS = 150;
/** A snapshot of the folded state is kept every this many events, so dragging never refolds it all. */
export const CHECKPOINT_EVERY = 50;

export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** A run log prepared for replay. `position` is always "how many events are applied" (0..events.length). */
export interface Replay {
  /** In `seq` order, without duplicates. */
  events: readonly RunLogEvent[];
  /** `checkpoints[k]` is the state after the first `k * CHECKPOINT_EVERY` events. */
  checkpoints: readonly RunLiveState[];
  /** `gaps[i]`: wait at 1× before event `i` is applied (real gap clamped to MIN..MAX; 0 for the first). */
  gaps: readonly number[];
  /** Real time between the first and the last event, and the same after the waits were shortened. */
  realMs: number;
  playMs: number;
  /** How many waits were longer than `MAX_GAP_MS` and had to be shortened. */
  shortenedGaps: number;
  /** `elapsedMs[i]`: real time from the first event to event `i`. */
  elapsedMs: readonly number[];
}

const timeOf = (event: RunLogEvent) => Date.parse(event.at);

export function buildReplay(log: readonly RunLogEvent[]): Replay {
  const sorted = [...log].sort((a, b) => a.seq - b.seq);
  const events = sorted.filter((e, i) => i === 0 || e.seq !== sorted[i - 1]?.seq);

  const gaps: number[] = [];
  const elapsedMs: number[] = [];
  let shortenedGaps = 0;
  let playMs = 0;
  let realMs = 0;
  let previous = events[0] ? timeOf(events[0]) : NaN;
  events.forEach((event, i) => {
    const at = timeOf(event);
    if (i === 0) gaps.push(0);
    else {
      const real = Number.isNaN(at) || Number.isNaN(previous) ? 0 : Math.max(0, at - previous);
      const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, real));
      if (real > MAX_GAP_MS) shortenedGaps += 1;
      gaps.push(gap);
      playMs += gap;
      realMs += real;
    }
    elapsedMs.push(realMs);
    if (!Number.isNaN(at)) previous = at;
  });

  const checkpoints: RunLiveState[] = [initialRunLiveState];
  let state = initialRunLiveState;
  events.forEach((event, i) => {
    state = reduceRunEvent(state, event);
    if ((i + 1) % CHECKPOINT_EVERY === 0) checkpoints.push(state);
  });
  return { events, checkpoints, gaps, realMs, playMs, shortenedGaps, elapsedMs };
}

/** The state after the first `position` events: from the nearest snapshot, folding at most 49. */
export function stateAt(replay: Replay, position: number): RunLiveState {
  const target = Math.min(Math.max(0, Math.trunc(position)), replay.events.length);
  const k = Math.floor(target / CHECKPOINT_EVERY);
  let state = replay.checkpoints[k] ?? initialRunLiveState;
  for (let i = k * CHECKPOINT_EVERY; i < target; i++) {
    const event = replay.events[i];
    if (event) state = reduceRunEvent(state, event);
  }
  return state;
}

/**
 * The pulse of the message sent by the one event a forward step or play tick just applied
 * (`to === from + 1`). Any other move — back, or a seek of more than one event — has none: it is a
 * jump, not a flow.
 */
export function pulsesBetween(replay: Replay, from: number, to: number): LivePulse[] {
  if (to !== from + 1) return [];
  const seqs = new Set(replay.events.slice(from, to).map((e) => e.seq));
  return stateAt(replay, to).pulses.filter((p) => seqs.has(p.seq));
}

/** Wait before applying event `index`, at the chosen speed. */
export const delayBefore = (replay: Replay, index: number, speed: number): number =>
  (replay.gaps[index] ?? 0) / speed;
