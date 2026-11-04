import type {
  AgentLive,
  AgentLiveStatus,
  LiveMessageKind,
  LivePulse,
  RunLiveEvent,
  RunLiveFinish,
  RunLiveState,
  RunLiveStatus,
  RunLogEvent,
  TerminalChunk,
} from "./types";

export const PREVIEW_MAX = 200;
export const MAX_PULSES = 20;
/** Terminal output kept per agent (characters). The xterm.js of T14b has its own scrollback. */
export const TERMINAL_MAX_CHARS = 200_000;

export const initialRunLiveState: RunLiveState = {
  status: "pending",
  finish: null,
  input: null,
  budgetUsd: null,
  lastSeq: 0,
  agents: {},
  timeline: [],
  pulses: [],
  totals: { costUsd: 0, turns: 0, unknownCostTurns: 0 },
  guardEvents: [],
  terminals: {},
};

const STATUS_BY_REASON: Record<RunLiveFinish["reason"], RunLiveStatus> = {
  finished: "succeeded",
  quiescent: "succeeded",
  stopped: "cancelled",
  failed: "failed",
  guard_tripped: "failed",
};

const MESSAGE_KINDS: readonly string[] = ["message", "ask", "reply"];
const isTerminalChunk = (event: RunLiveEvent): event is TerminalChunk =>
  event.type === "TerminalOutput";
/** `@human` and `@trigger` are senders, not agents. */
const isAgentName = (name: string) => !name.startsWith("@");
const isDead = (status: AgentLiveStatus) => status === "failed" || status === "finished";

/**
 * Applies one run event. Pure: no React, no clock, no I/O. An event at or below `lastSeq` returns the
 * same state (applying a log twice, or a duplicate from a reconnection, changes nothing), and an
 * unknown type only advances `lastSeq`, so a newer server never breaks an older screen.
 */
export function reduceRunEvent(state: RunLiveState, event: RunLiveEvent): RunLiveState {
  if (isTerminalChunk(event)) return reduceTerminal(state, event);
  if (event.seq <= state.lastSeq) return state;

  const next = { ...state, lastSeq: event.seq };
  const payload = asRecord(event.payload);
  switch (event.type) {
    case "RunStarted":
      return {
        ...next,
        status: "running",
        input: text(payload["input"]),
        budgetUsd: typeof payload["budgetUsd"] === "number" ? payload["budgetUsd"] : null,
      };
    case "RunFinished":
      return finishRun(next, event, payload);
    case "AgentStarted":
      return event.agent
        ? setAgent(next, event.agent, event.seq, (a) => ({
            status: isDead(a.status) ? a.status : "starting",
          }))
        : next;
    case "AgentFailed":
      return event.agent
        ? setAgent(next, event.agent, event.seq, () => ({
            status: "failed",
            failure: text(payload["reason"]) ?? "O agente falhou.",
          }))
        : next;
    case "MessageSent":
      return messageSent(next, event, payload);
    case "MessageDelivered":
      return messageDelivered(next, event, payload);
    case "UsageRecorded":
      return usageRecorded(next, event, payload);
    case "GuardTripped":
    case "GuardWarning":
      return {
        ...next,
        guardEvents: [
          ...next.guardEvents,
          {
            seq: event.seq,
            type: event.type,
            guard: text(payload["guard"]) ?? "?",
            agent: event.agent,
            message: text(payload["reason"]) ?? text(payload["message"]) ?? "",
            at: event.at,
          },
        ],
      };
    default:
      return next;
  }
}

function reduceTerminal(state: RunLiveState, chunk: TerminalChunk): RunLiveState {
  const previous = chunk.replay ? "" : (state.terminals[chunk.agent] ?? "");
  const joined = previous + chunk.data;
  const kept = joined.length > TERMINAL_MAX_CHARS ? joined.slice(-TERMINAL_MAX_CHARS) : joined;
  return { ...state, terminals: { ...state.terminals, [chunk.agent]: kept } };
}

function finishRun(
  state: RunLiveState,
  event: RunLogEvent,
  payload: Record<string, unknown>,
): RunLiveState {
  const reason = payload["reason"] as RunLiveFinish["reason"];
  const known = reason in STATUS_BY_REASON;
  const agents: Record<string, AgentLive> = {};
  for (const [name, agent] of Object.entries(state.agents)) {
    agents[name] = isDead(agent.status) ? agent : { ...agent, status: "finished" };
  }
  return {
    ...state,
    agents,
    status: known ? STATUS_BY_REASON[reason] : "failed",
    finish: {
      seq: event.seq,
      reason: known ? reason : "failed",
      agent: text(payload["agent"]),
      result: text(payload["result"]),
      error: text(payload["error"]),
      guard: text(payload["guard"]),
      message: text(payload["message"]),
    },
  };
}

function messageSent(
  state: RunLiveState,
  event: RunLogEvent,
  payload: Record<string, unknown>,
): RunLiveState {
  const from = text(payload["from"]) ?? event.agent;
  const to = text(payload["to"]);
  const kind = payload["kind"];
  if (!from || !to || typeof kind !== "string" || !MESSAGE_KINDS.includes(kind)) return state;
  const messageKind = kind as LiveMessageKind;

  let next = state;
  if (isAgentName(from)) {
    next = setAgent(next, from, event.seq, (a) => ({
      // An open `ask` holds its sender until the reply is delivered.
      status: messageKind === "ask" && !isDead(a.status) ? "waiting_reply" : a.status,
    }));
  }
  if (isAgentName(to)) next = setAgent(next, to, event.seq, () => ({}));

  const pulse: LivePulse = { from, to, kind: messageKind, seq: event.seq };
  return {
    ...next,
    timeline: [
      ...next.timeline,
      {
        seq: event.seq,
        messageId: text(payload["messageId"]) ?? `seq-${event.seq}`,
        from,
        to,
        kind: messageKind,
        replyTo: text(payload["replyTo"]),
        preview: preview(text(payload["body"]) ?? ""),
        delivered: false,
        at: event.at,
      },
    ],
    pulses: [...next.pulses, pulse].slice(-MAX_PULSES),
  };
}

function messageDelivered(
  state: RunLiveState,
  event: RunLogEvent,
  payload: Record<string, unknown>,
): RunLiveState {
  const to = text(payload["to"]) ?? event.agent;
  const messageId = text(payload["messageId"]);
  let next: RunLiveState = messageId
    ? {
        ...state,
        timeline: state.timeline.map((m) =>
          m.messageId === messageId ? { ...m, delivered: true } : m,
        ),
      }
    : state;
  if (to && isAgentName(to)) {
    // Receiving a message (or the reply it was waiting for) puts the agent to work.
    next = setAgent(next, to, event.seq, (a) => ({ status: isDead(a.status) ? a.status : "busy" }));
  }
  return next;
}

function usageRecorded(
  state: RunLiveState,
  event: RunLogEvent,
  payload: Record<string, unknown>,
): RunLiveState {
  if (!event.agent) return state;
  // Only a real number is a price: null, a missing field or garbage all mean "unknown".
  const cost = typeof payload["costUsd"] === "number" ? payload["costUsd"] : null;
  const next = setAgent(state, event.agent, event.seq, (a) => ({
    costUsd: cost === null ? a.costUsd : (a.costUsd ?? 0) + cost,
    turns: a.turns + 1,
    unknownCostTurns: a.unknownCostTurns + (cost === null ? 1 : 0),
    // The turn ended: a working agent is idle until the next delivery.
    status: a.status === "busy" ? "idle" : a.status,
  }));
  return {
    ...next,
    totals: {
      costUsd: next.totals.costUsd + (cost ?? 0),
      turns: next.totals.turns + 1,
      unknownCostTurns: next.totals.unknownCostTurns + (cost === null ? 1 : 0),
    },
  };
}

/** Creates the agent on first sight (`starting`) and applies a patch; always bumps `lastSeq`. */
function setAgent(
  state: RunLiveState,
  name: string,
  seq: number,
  patch: (agent: AgentLive) => Partial<AgentLive>,
): RunLiveState {
  const current: AgentLive = state.agents[name] ?? {
    name,
    status: "starting",
    costUsd: null,
    turns: 0,
    unknownCostTurns: 0,
    lastSeq: 0,
    failure: null,
  };
  return {
    ...state,
    agents: { ...state.agents, [name]: { ...current, ...patch(current), lastSeq: seq } },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}
