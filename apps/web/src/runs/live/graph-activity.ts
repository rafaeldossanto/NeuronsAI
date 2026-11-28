import type { GraphNode } from "@neurons/graph-schema";
import type { BlockLive } from "@/graphs/editor/nodes";
import type { LivePulse, RunLiveState } from "./types";

/** Live events address agents by the name in their frozen version. */
export function liveByNode(
  nodes: readonly GraphNode[],
  agents: RunLiveState["agents"],
): Record<string, BlockLive> {
  const result: Record<string, BlockLive> = {};
  for (const node of nodes) {
    if (node.type !== "agent") continue;
    const agent = agents[node.name];
    if (agent)
      result[node.id] = {
        status: agent.status,
        costUsd: agent.costUsd,
        costIsMinimum: agent.unknownCostTurns > 0,
      };
  }
  return result;
}

/** A message counts as just sent for eight seconds, including a short socket catch-up. */
export function isRecentPulse(state: Pick<RunLiveState, "timeline">, pulse: LivePulse): boolean {
  const message = state.timeline.findLast((item) => item.seq === pulse.seq);
  const sentAt = message ? Date.parse(message.at) : NaN;
  return Number.isNaN(sentAt) || Date.now() - sentAt < 8_000;
}
