import type { AgentUsage, ToolCallReport } from "@neurons/agent-runtimes";
import type { RunEventDraft } from "../run-log/run-event-draft.js";
import type { AgentLifecycleState } from "./agent-state.js";
import type { MessageRecord } from "./message.js";

/** Bounds of what one tool call may put in the log, whatever the peer sent. */
export const MAX_TOOL_NAME_CHARS = 100;
export const MAX_TOOL_SUMMARY_CHARS = 1_000;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** The events the Hub and the Supervisor write to the run log. */
export const HubEvents = {
  messageSent: (message: MessageRecord): RunEventDraft => ({
    type: "MessageSent",
    agent: message.from,
    payload: {
      messageId: message.id,
      from: message.from,
      to: message.to,
      kind: message.kind,
      replyTo: message.replyTo,
      body: message.body,
    },
  }),

  /** The recipient confirmed it received the message. */
  messageDelivered: (message: MessageRecord): RunEventDraft => ({
    type: "MessageDelivered",
    agent: message.to,
    payload: {
      messageId: message.id,
      from: message.from,
      to: message.to,
      deliveredAt: message.deliveredAt,
      ackedAt: message.ackedAt,
    },
  }),

  agentStarted: (agent: string, briefing: string): RunEventDraft => ({
    type: "AgentStarted",
    agent,
    payload: { briefing },
  }),

  /** What one turn of an agent consumed, as its runtime reports it. */
  usageRecorded: (agent: string, usage: AgentUsage): RunEventDraft => ({
    type: "UsageRecorded",
    agent,
    // A missing price is written as an explicit null, so "unknown" never reads as "free".
    payload: { ...usage, costUsd: usage.costUsd ?? null },
  }),

  /** The agent changed state. Written only when it really changed, never to repeat the last one. */
  agentStateChanged: (
    agent: string,
    state: AgentLifecycleState,
    reason?: string,
  ): RunEventDraft => ({
    type: "AgentStateChanged",
    agent,
    payload: { state, ...(reason !== undefined && { reason }) },
  }),

  /** The agent used a tool. `inputSummary` is already secret-free; this only bounds its size. */
  toolCalled: (agent: string, report: ToolCallReport): RunEventDraft => ({
    type: "ToolCalled",
    agent,
    payload: {
      tool: clip(report.tool, MAX_TOOL_NAME_CHARS),
      inputSummary: clip(report.inputSummary, MAX_TOOL_SUMMARY_CHARS),
      durationMs: Math.max(0, Math.round(report.durationMs)),
      ok: report.ok,
      errorCode: report.errorCode ?? null,
    },
  }),

  agentFailed: (agent: string, reason: string): RunEventDraft => ({
    type: "AgentFailed",
    agent,
    payload: { reason },
  }),
};
