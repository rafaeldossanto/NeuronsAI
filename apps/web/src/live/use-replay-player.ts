import { useEffect, useMemo, useRef, useState } from "react";
import { PULSE_TTL_MS } from "./pulse-edges";
import { delayBefore, pulsesBetween, stateAt, type Replay, type ReplaySpeed } from "./replay";
import type { LivePulse, RunLiveState } from "./types";

const MAX_PULSES = 12;

export interface ReplayPlayer {
  /** How many events are applied (0..total). */
  position: number;
  total: number;
  state: RunLiveState;
  /** Pulses to draw now: the messages of the latest forward steps, until `PULSE_TTL_MS` passes. */
  pulses: LivePulse[];
  playing: boolean;
  speed: ReplaySpeed;
  atEnd: boolean;
  toggle: () => void;
  stepForward: () => void;
  stepBack: () => void;
  seek: (position: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
}

/**
 * Drives a replay: the cursor, play/pause and speed. The state at the cursor is always
 * `stateAt(replay, position)`, so back and seek cost at most one checkpoint's worth of folding.
 * While playing, the next event is applied after its (shortened) wait divided by the speed.
 * A pulse is drawn only for a forward step of one event (a play tick or the "next" button), never
 * for a seek; at high speed several can overlap (up to 12) and each fades after `PULSE_TTL_MS`.
 */
export function useReplayPlayer(replay: Replay): ReplayPlayer {
  const total = replay.events.length;
  const [position, setPosition] = useState(0);
  const [pulses, setPulses] = useState<LivePulse[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const state = useMemo(() => stateAt(replay, position), [replay, position]);

  /** Moves the cursor. Called from handlers and timers only, so it can set the pulses too. */
  const go = (target: number) => {
    const next = Math.min(Math.max(0, target), total);
    const forwardOne = next === position + 1;
    const added = forwardOne ? pulsesBetween(replay, position, next) : [];
    setPosition(next);
    setPulses((current) => (forwardOne ? [...current, ...added].slice(-MAX_PULSES) : []));
    if (added.length > 0) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setPulses((current) => current.filter((p) => !added.includes(p)));
      }, PULSE_TTL_MS);
      timers.current.add(timer);
    }
    if (next >= total) setPlaying(false);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // Playing: one timeout for the next event, re-armed after each one.
  useEffect(() => {
    if (!playing || position >= total) return;
    const timer = setTimeout(
      () => goRef.current(position + 1),
      delayBefore(replay, position, speed),
    );
    return () => clearTimeout(timer);
  }, [playing, position, speed, replay, total]);

  return {
    position,
    total,
    state,
    pulses,
    playing,
    speed,
    atEnd: position >= total,
    toggle: () => {
      if (playing) return setPlaying(false);
      if (total === 0) return;
      if (position >= total) go(0);
      setPlaying(true);
    },
    stepForward: () => {
      setPlaying(false);
      go(position + 1);
    },
    stepBack: () => {
      setPlaying(false);
      go(position - 1);
    },
    seek: (target) => {
      setPlaying(false);
      go(target);
    },
    setSpeed,
  };
}
