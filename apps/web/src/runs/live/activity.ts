import type { LiveDraft, LiveMessage, LiveToolCall, RunLiveState } from "./types";

/** A text an agent is writing now, ready to show under the timeline or in the agent's panel. */
export interface ActivityDraft extends LiveDraft {
  agent: string;
  /** The agent is still working, so the text is still growing (otherwise it is its latest words). */
  writing: boolean;
}

/**
 * What agents are writing now, the free text first and then the messages, by agent name. With
 * `agent`, only that one's. It reads `drafts` and the agents' status, nothing is stored twice.
 */
export function selectDrafts(
  state: Pick<RunLiveState, "drafts" | "agents">,
  agent?: string,
): ActivityDraft[] {
  const names = agent ? [agent] : Object.keys(state.drafts).sort();
  return names.flatMap((name) => {
    const writing = state.agents[name]?.status === "busy";
    return (state.drafts[name] ?? []).map((draft) => ({ ...draft, agent: name, writing }));
  });
}

/** One row of the run's single timeline: a message between agents or a tool call. */
export type ActivityItem = ({ type: "message" } & LiveMessage) | ({ type: "tool" } & LiveToolCall);

/**
 * Messages and tool calls in one list, in `seq` order. It only merges what the state already keeps
 * (`timeline` and `toolCalls`), so nothing is stored twice. With `agent`, only what that agent sent,
 * received or called.
 */
export function selectActivity(
  state: Pick<RunLiveState, "timeline" | "toolCalls">,
  agent?: string,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const messages = agent
    ? state.timeline.filter((m) => m.from === agent || m.to === agent)
    : state.timeline;
  const tools = agent ? state.toolCalls.filter((t) => t.agent === agent) : state.toolCalls;
  let m = 0;
  let t = 0;
  while (m < messages.length || t < tools.length) {
    const message = messages[m];
    const tool = tools[t];
    if (message && (!tool || message.seq < tool.seq)) {
      items.push({ type: "message", ...message });
      m += 1;
    } else if (tool) {
      items.push({ type: "tool", ...tool });
      t += 1;
    }
  }
  return items;
}
