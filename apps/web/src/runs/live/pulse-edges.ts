import { useEffect, useRef, useState } from "react";
import type { GraphDefinition } from "@neurons/graph-schema";
import type { LivePulse } from "./types";

/** A pulse placed on one arrow of the drawing. */
export interface EdgePulse {
  seq: number;
  /** True when the message goes against the arrow's direction (the other way of a two-way link). */
  reverse: boolean;
}

/** An arrow's id in the editor: the link's id, or `trigger:<id>` for a trigger's own arrow. */
const TRIGGER_EDGE = "trigger:";

/**
 * Finds the arrow each pulse travels, in the sender's direction. Agents are matched to blocks by
 * `node.name`. `@trigger` runs along the arrow of the trigger that points at the recipient; `@human`
 * has no block, so its pulses are left out, as are messages with no arrow between the two agents.
 */
export function pulsesByEdge(
  doc: Pick<GraphDefinition, "nodes" | "links">,
  pulses: readonly LivePulse[],
): Record<string, EdgePulse[]> {
  const idByName = new Map<string, string>();
  for (const node of doc.nodes) if (node.type === "agent") idByName.set(node.name, node.id);

  const result: Record<string, EdgePulse[]> = {};
  const add = (edgeId: string, pulse: EdgePulse) => (result[edgeId] ??= []).push(pulse);

  for (const pulse of pulses) {
    const to = idByName.get(pulse.to);
    if (!to) continue;
    if (pulse.from === "@trigger") {
      const trigger = doc.nodes.find((n) => n.type === "trigger" && n.target === to);
      if (trigger) add(`${TRIGGER_EDGE}${trigger.id}`, { seq: pulse.seq, reverse: false });
      continue;
    }
    const from = idByName.get(pulse.from);
    if (!from) continue;
    const forward = doc.links.find((l) => l.from === from && l.to === to);
    if (forward) {
      add(forward.id, { seq: pulse.seq, reverse: false });
      continue;
    }
    const backward = doc.links.find((l) => l.from === to && l.to === from);
    if (backward) add(backward.id, { seq: pulse.seq, reverse: true });
  }
  return result;
}

export const PULSE_TTL_MS = 1200;
const MAX_ACTIVE_PULSES = 12;

/**
 * Pulses to draw right now. Each message animates once (the highest `seq` seen is remembered), only
 * when `isFresh` says it just happened, so the history that arrives when the screen opens does not
 * replay as a burst. At most 12 run at the same time: more than that is noise.
 */
export function useActivePulses(
  pulses: readonly LivePulse[],
  isFresh: (pulse: LivePulse) => boolean = () => true,
): LivePulse[] {
  const seen = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [active, setActive] = useState<LivePulse[]>([]);
  const freshRef = useRef(isFresh);
  useEffect(() => {
    freshRef.current = isFresh;
  });

  useEffect(() => {
    const unseen = pulses.filter((p) => p.seq > seen.current);
    const last = unseen.at(-1);
    if (!last) return;
    seen.current = last.seq;
    const animate = unseen.filter((p) => freshRef.current(p)).slice(-MAX_ACTIVE_PULSES);
    if (animate.length === 0) return;
    setActive((current) => [...current, ...animate].slice(-MAX_ACTIVE_PULSES));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setActive((current) => current.filter((p) => !animate.includes(p)));
    }, PULSE_TTL_MS);
    timers.current.add(timer);
  }, [pulses]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return active;
}
