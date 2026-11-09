import type { LiveMessage, LiveToolCall, RunLiveState } from "./types";

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
