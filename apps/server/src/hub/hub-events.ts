import type { AgentUsage } from "@neurons/agent-runtimes";
import type { RunEventDraft } from "../run-log/run-event-draft.js";
import type { MessageRecord } from "./message.js";

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
    payload: usage,
  }),

  agentFailed: (agent: string, reason: string): RunEventDraft => ({
    type: "AgentFailed",
    agent,
    payload: { reason },
  }),
};
