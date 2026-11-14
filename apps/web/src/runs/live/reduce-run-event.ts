import type {
  AgentDeltaChunk,
  AgentLive,
  AgentLiveStatus,
  LiveMessageKind,
  LiveDraft,
  LivePulse,
  RunLiveEvent,
  RunLiveFinish,
  RunLiveState,
  RunLiveStatus,
  RunLogEvent,
  TerminalChunk,
  TerminalSize,
} from "./types";

export const PREVIEW_MAX = 200;
export const MAX_PULSES = 20;
/** Terminal output kept per agent (characters). The xterm.js panel has its own scrollback. */
export const TERMINAL_MAX_CHARS = 200_000;
/**
 * The output is only cut once it passes the limit by this much, down to the limit: a chatty agent then
 * pays for one slice every `TERMINAL_TRIM_SLACK` characters instead of one per chunk.
 */
export const TERMINAL_TRIM_SLACK = 50_000;
/** Most recent entries kept in `timeline`, `toolCalls` and `guardEvents`; the screen says when older ones were dropped. */
export const MAX_ACTIVITY = 500;
/** Characters kept of one draft (the latest ones); a model can write far more than a screen shows. */
export const DRAFT_MAX_CHARS = 8_000;
/** Message drafts kept per agent: one reply may write several messages (one per tool call). */
export const MAX_MESSAGE_DRAFTS = 4;

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
  toolCalls: [],
  trimmed: { timeline: 0, toolCalls: 0, guardEvents: 0 },
  terminals: {},
  terminalMeta: {},
  drafts: {},
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
const isTerminalSize = (event: RunLiveEvent): event is TerminalSize =>
  event.type === "TerminalResized";
const isAgentDelta = (event: RunLiveEvent): event is AgentDeltaChunk =>
  event.type === "AgentOutputDelta";
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
  if (isTerminalSize(event)) return reduceTerminalSize(state, event);
  if (isAgentDelta(event)) return reduceDelta(state, event);
  if (event.seq <= state.lastSeq) return state;

  const next = withDraftsSettled({ ...state, lastSeq: event.seq }, event);
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
        ? setAgent(next, event.agent, event.seq, (a) => deduce(a, "starting"))
        : next;
    case "AgentStateChanged":
      return event.agent ? agentStateChanged(next, event.agent, event.seq, payload) : next;
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
    case "ToolCalled": {
      let summary: Record<string, unknown> = {};
      try {
        summary = asRecord(JSON.parse(text(payload["inputSummary"]) ?? "{}"));
      } catch {
        // Older runners can report a plain-text summary instead of JSON.
      }
      const [toolCalls, dropped] = appendCapped(next.toolCalls, {
        seq: event.seq,
        agent: event.agent,
        tool: text(payload["tool"]) ?? "Ferramenta",
        path: text(summary["path"]),
        ok: payload["ok"] === true,
        durationMs: typeof payload["durationMs"] === "number" ? payload["durationMs"] : null,
        errorCode: text(payload["errorCode"]),
        at: event.at,
      });
      return {
        ...next,
        toolCalls,
        trimmed: { ...next.trimmed, toolCalls: next.trimmed.toolCalls + dropped },
      };
    }
    case "GuardTripped":
    case "GuardWarning": {
      const [guardEvents, dropped] = appendCapped(next.guardEvents, {
        seq: event.seq,
        type: event.type,
        guard: text(payload["guard"]) ?? "?",
        agent: event.agent,
        message: text(payload["reason"]) ?? text(payload["message"]) ?? "",
        at: event.at,
      });
      return {
        ...next,
        guardEvents,
        trimmed: { ...next.trimmed, guardEvents: next.trimmed.guardEvents + dropped },
      };
    }
    default:
      return next;
  }
}

/** Appends keeping the last `MAX_ACTIVITY` entries; also says how many old ones fell off. */
function appendCapped<T>(list: readonly T[], item: T): [T[], number] {
  const grown = [...list, item];
  const dropped = Math.max(0, grown.length - MAX_ACTIVITY);
  return [dropped > 0 ? grown.slice(dropped) : grown, dropped];
}

const AGENT_STATES: readonly string[] = [
  "starting",
  "busy",
  "idle",
  "waiting_reply",
  "failed",
  "finished",
];

/**
 * The server's word on an agent's state (T14b). From the first one on, the agent's status comes only
 * from these events: the deduction below is the fallback for runs recorded before they existed. A
 * state this screen does not know is ignored (a newer server never breaks an older screen), and an
 * agent that failed stays failed.
 */
function agentStateChanged(
  state: RunLiveState,
  agent: string,
  seq: number,
  payload: Record<string, unknown>,
): RunLiveState {
  const reported = payload["state"];
  if (typeof reported !== "string" || !AGENT_STATES.includes(reported)) return state;
  const status = reported as AgentLiveStatus;
  return setAgent(state, agent, seq, (a) => ({
    stateSource: "event",
    status: a.status === "failed" ? "failed" : status,
    failure:
      status === "failed"
        ? (a.failure ?? text(payload["reason"]) ?? "O agente falhou.")
        : a.failure,
  }));
}

/** The status inferred from the log; it only applies to an agent that never reported its own state. */
function deduce(agent: AgentLive, status: AgentLiveStatus): Partial<AgentLive> {
  if (agent.stateSource === "event" || isDead(agent.status)) return {};
  return { status };
}

/**
 * A piece of what an agent is writing. The free text keeps only its latest turn (a new turn
 * replaces it); each message being written has its own draft. Ignored once the run is over.
 */
function reduceDelta(state: RunLiveState, chunk: AgentDeltaChunk): RunLiveState {
  if (state.finish) return state;
  const current = state.drafts[chunk.agent] ?? [];
  const sameTurn = current.find((d) => d.turnId === chunk.turnId && d.channel === chunk.channel);
  let drafts: LiveDraft[];
  if (sameTurn) {
    drafts = current.map((d) => (d === sameTurn ? grow(d, chunk.delta) : d));
  } else {
    const fresh = grow(
      { turnId: chunk.turnId, channel: chunk.channel, body: "", cut: false },
      chunk.delta,
    );
    drafts =
      chunk.channel === "text"
        ? [...current.filter((d) => d.channel !== "text"), fresh]
        : [...current, fresh];
    const messages = drafts.filter((d) => d.channel === "message");
    if (messages.length > MAX_MESSAGE_DRAFTS) {
      const dropped = new Set(messages.slice(0, messages.length - MAX_MESSAGE_DRAFTS));
      drafts = drafts.filter((d) => !dropped.has(d));
    }
  }
  return { ...state, drafts: { ...state.drafts, [chunk.agent]: drafts } };
}

function grow(draft: LiveDraft, delta: string): LiveDraft {
  const joined = draft.body + delta;
  return joined.length > DRAFT_MAX_CHARS
    ? { ...draft, body: joined.slice(-DRAFT_MAX_CHARS), cut: true }
    : { ...draft, body: joined };
}

/**
 * The log catches up with what was being written: the message that was sent replaces the oldest
 * draft of its sender, and an agent that is no longer working keeps no half-written message (the
 * call may have failed, or the turn ended otherwise). The free text stays, as the agent's latest
 * words, until the next turn or the end of the run.
 */
function withDraftsSettled(state: RunLiveState, event: RunLogEvent): RunLiveState {
  if (Object.keys(state.drafts).length === 0) return state;
  const payload = asRecord(event.payload);
  switch (event.type) {
    case "MessageSent": {
      const from = text(payload["from"]) ?? event.agent;
      return from ? dropDrafts(state, from, "oldest-message") : state;
    }
    case "AgentStateChanged":
      return event.agent && payload["state"] !== "busy"
        ? dropDrafts(state, event.agent, "messages")
        : state;
    case "AgentFailed":
      return event.agent ? dropDrafts(state, event.agent, "all") : state;
    case "RunFinished":
      return { ...state, drafts: {} };
    default:
      return state;
  }
}

function dropDrafts(
  state: RunLiveState,
  agent: string,
  what: "oldest-message" | "messages" | "all",
): RunLiveState {
  const current = state.drafts[agent];
  if (!current) return state;
  const oldest = current.find((d) => d.channel === "message");
  const kept =
    what === "all"
      ? []
      : what === "messages"
        ? current.filter((d) => d.channel !== "message")
        : current.filter((d) => d !== oldest);
  if (kept.length === current.length) return state;
  const drafts = { ...state.drafts };
  if (kept.length > 0) drafts[agent] = kept;
  else delete drafts[agent];
  return { ...state, drafts };
}

function reduceTerminal(state: RunLiveState, chunk: TerminalChunk): RunLiveState {
  const previous = chunk.replay ? "" : (state.terminals[chunk.agent] ?? "");
  const joined = previous + chunk.data;
  const kept =
    joined.length > TERMINAL_MAX_CHARS + TERMINAL_TRIM_SLACK
      ? joined.slice(-TERMINAL_MAX_CHARS)
      : joined;
  const meta = state.terminalMeta[chunk.agent] ?? { resets: 0, total: 0 };
  return {
    ...state,
    terminals: { ...state.terminals, [chunk.agent]: kept },
    terminalMeta: {
      ...state.terminalMeta,
      [chunk.agent]: chunk.replay
        ? {
            resets: meta.resets + 1,
            total: chunk.data.length,
            ...sizeOf(chunk.cols ?? meta.cols, chunk.rows ?? meta.rows),
          }
        : { ...meta, total: meta.total + chunk.data.length },
    },
  };
}

/** The terminal changed size: the screen keeps what it shows, the view only takes the new size. */
function reduceTerminalSize(state: RunLiveState, event: TerminalSize): RunLiveState {
  const meta = state.terminalMeta[event.agent] ?? { resets: 0, total: 0 };
  return {
    ...state,
    terminalMeta: {
      ...state.terminalMeta,
      [event.agent]: { ...meta, cols: event.cols, rows: event.rows },
    },
  };
}

const sizeOf = (cols: number | undefined, rows: number | undefined) =>
  cols !== undefined && rows !== undefined ? { cols, rows } : {};

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
    // An open `ask` holds its sender until the reply is delivered (fallback; see `deduce`).
    next = setAgent(next, from, event.seq, (a) =>
      messageKind === "ask" ? deduce(a, "waiting_reply") : {},
    );
  }
  if (isAgentName(to)) next = setAgent(next, to, event.seq, () => ({}));

  const pulse: LivePulse = { from, to, kind: messageKind, seq: event.seq };
  const [timeline, dropped] = appendCapped(next.timeline, {
    seq: event.seq,
    messageId: text(payload["messageId"]) ?? `seq-${event.seq}`,
    from,
    to,
    kind: messageKind,
    replyTo: text(payload["replyTo"]),
    preview: preview(text(payload["body"]) ?? ""),
    delivered: false,
    at: event.at,
  });
  return {
    ...next,
    timeline,
    trimmed: { ...next.trimmed, timeline: next.trimmed.timeline + dropped },
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
    next = setAgent(next, to, event.seq, (a) => deduce(a, "busy"));
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
    // The turn ended: a working agent is idle until the next delivery (fallback; see `deduce`).
    ...(a.status === "busy" ? deduce(a, "idle") : {}),
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
    stateSource: "deduced",
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
