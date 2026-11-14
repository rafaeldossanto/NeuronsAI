import { agentNodeSchema } from "@neurons/graph-schema";
import { z } from "zod";
import { PROTOCOL_VERSION } from "./version.js";

const frame = <Type extends string, Shape extends z.ZodRawShape>(type: Type, shape: Shape) =>
  z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal(type), ...shape });

// ---- shared pieces ----

/** Same states as `AgentRuntimeState` of `@neurons/agent-runtimes` (the protocol is its own contract). */
export const AGENT_STATES = [
  "starting",
  "busy",
  "idle",
  "waiting_reply",
  "stopped",
  "failed",
] as const;
export const agentStateSchema = z.enum(AGENT_STATES);
export type AgentState = z.infer<typeof agentStateSchema>;

const instanceId = z.string().min(1).max(100);
const requestId = z.string().min(1).max(100);
const errorSchema = z.object({ message: z.string().max(10_000) });

/** A message the Hub hands to an agent. */
export const inboundMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  kind: z.enum(["message", "ask", "reply"]),
  body: z.string(),
  replyTo: z.string().nullable(),
});
export type InboundMessageWire = z.infer<typeof inboundMessageSchema>;

export const usageSchema = z.object({
  model: z.string().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  turns: z.number().optional(),
});

/** A tool call as it enters the run log: bounded, so a peer cannot flood the log with one event. */
export const MAX_TOOL_NAME_CHARS = 100;
export const MAX_TOOL_INPUT_SUMMARY_CHARS = 1_000;
export const toolCallReportSchema = z.object({
  tool: z.string().min(1).max(MAX_TOOL_NAME_CHARS),
  inputSummary: z.string().max(MAX_TOOL_INPUT_SUMMARY_CHARS),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  errorCode: z.string().max(100).optional(),
});

/** Settings of the server that a runner needs to build the runtimes the way the server expects. */
export const startSettingsSchema = z.object({
  askTimeoutMs: z.number().int().positive(),
  usageFlushMs: z.number().int().nonnegative(),
});
export type StartSettings = z.infer<typeof startSettingsSchema>;

export const instanceSnapshotSchema = z.object({
  instanceId,
  state: agentStateSchema,
  failureReason: z.string().optional(),
});
export type InstanceSnapshot = z.infer<typeof instanceSnapshotSchema>;

// ---- calls: what an agent does through the Hub (runner -> server) ----

/** The communication tools of an agent, as remote procedure calls (`AgentCommunication`). */
export const callSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("send_message"), to: z.string(), text: z.string() }),
  z.object({
    method: z.literal("ask"),
    to: z.string(),
    question: z.string(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  z.object({ method: z.literal("reply"), messageId: z.string(), text: z.string() }),
  z.object({ method: z.literal("list_peers") }),
  z.object({ method: z.literal("finish"), result: z.string() }),
  z.object({ method: z.literal("report_usage"), usage: usageSchema }),
  /** Revision 2. Sent only to a server that announced revision 2 or later. */
  z.object({ method: z.literal("report_tool_call"), report: toolCallReportSchema }),
  z.object({ method: z.literal("list_tools") }),
  z.object({
    method: z.literal("use_tool"),
    nodeId: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
]);
export type Call = z.infer<typeof callSchema>;

// ---- runner -> server ----

export const registerFrame = frame("register", {
  runner: z.object({
    name: z.string().min(1).max(100),
    platform: z.string().max(50).optional(),
  }),
  capabilities: z.object({ terminal: z.boolean(), streamJson: z.boolean() }),
  /** Protocol revision of the runner (see `PROTOCOL_REVISION`); absent means 1. */
  revision: z.number().int().positive().optional(),
  /** The agents the runner still hosts: after a reconnection this is how the server catches up. */
  agents: z.array(instanceSnapshotSchema),
});

export const runnerHeartbeatFrame = frame("heartbeat", {});

export const agentStateFrame = frame("agent.state", {
  instanceId,
  state: agentStateSchema,
  failureReason: z.string().optional(),
});

/** Raw terminal output (escape sequences included). Live only: lost bytes are not resent. */
export const agentOutputFrame = frame("agent.output", { instanceId, data: z.string() });

/**
 * An agent uses a tool of the Hub. `callId` is chosen by the runner and the same call is sent again
 * after a reconnection if no result arrived: the server answers a call it already ran with the
 * same outcome, so a message is never sent twice.
 */
export const callFrame = frame("call", { callId: requestId, instanceId, call: callSchema });

/** Biggest piece of live text one `agent.delta` carries (the runner groups tokens: pieces are small). */
export const MAX_OUTPUT_DELTA_CHARS = 20_000;

/**
 * A piece of what an agent writes while the model generates it. Revision 6. Live only, like
 * `agent.output`: never stored, not resent after a reconnection. `channel` and `turnId` are those
 * of `AgentOutputDelta` (`text`: the model's free text; `message`: a message body being written).
 */
export const agentDeltaFrame = frame("agent.delta", {
  instanceId,
  turnId: z.string().min(1).max(200),
  channel: z.enum(["text", "message"]),
  delta: z.string().min(1).max(MAX_OUTPUT_DELTA_CHARS),
});

/** Biggest terminal the protocol carries; the server applies its own, smaller, limits before asking. */
export const MAX_TERMINAL_COLS = 1_000;
export const MAX_TERMINAL_ROWS = 1_000;
const terminalCells = (max: number) => z.number().int().min(1).max(max);

/**
 * The terminal of an agent was resized, as the runner applied it. Revision 4. It comes after the
 * resize and before any output laid out for the new size, so the server can restart the replay of
 * the terminal exactly there.
 */
export const agentResizedFrame = frame("agent.resized", {
  instanceId,
  cols: terminalCells(MAX_TERMINAL_COLS),
  rows: terminalCells(MAX_TERMINAL_ROWS),
});

/** The runner's answer to a request of the server (`agent.start`, `agent.deliver`, `agent.stop`). */
export const responseFrame = frame("response", {
  requestId,
  ok: z.boolean(),
  error: errorSchema.optional(),
});

export const agentSnapshotFrame = frame("agent.snapshot", {
  instanceId,
  data: z.string().max(300000),
  cols: terminalCells(MAX_TERMINAL_COLS),
  rows: terminalCells(MAX_TERMINAL_ROWS),
});

export const runnerFrameSchema = z.discriminatedUnion("type", [
  registerFrame,
  runnerHeartbeatFrame,
  agentStateFrame,
  agentOutputFrame,
  agentDeltaFrame,
  agentResizedFrame,
  agentSnapshotFrame,
  callFrame,
  responseFrame,
]);
export type RunnerFrame = z.infer<typeof runnerFrameSchema>;

// ---- server -> runner ----

export const registeredFrame = frame("registered", {
  runnerId: z.string().min(1),
  /** Protocol revision of the server (see `PROTOCOL_REVISION`); absent means 1. */
  revision: z.number().int().positive().optional(),
  heartbeatIntervalMs: z.number().int().positive(),
  /** Agents the server still wants; the runner stops any other it hosts (orphans of a lost run). */
  keep: z.array(instanceId),
});

export const rejectFrame = frame("reject", {
  code: z.enum(["unauthorized", "unsupported_protocol", "invalid_frame", "not_accepted"]),
  message: z.string(),
});

export const serverHeartbeatFrame = frame("heartbeat", {});

export const agentStartFrame = frame("agent.start", {
  requestId,
  instanceId,
  agent: agentNodeSchema,
  briefing: z.string(),
  settings: startSettingsSchema,
  /** Transient execution credential, never a graph field or log payload. Revision 3+. */
  credentials: z.object({ apiKey: z.string().min(1).max(16384) }).optional(),
});

export const agentDeliverFrame = frame("agent.deliver", {
  requestId,
  instanceId,
  message: inboundMessageSchema,
});

export const agentStopFrame = frame("agent.stop", { requestId, instanceId });

/** The user typed into an agent's terminal. */
export const agentInputFrame = frame("agent.input", { instanceId, data: z.string() });

/** The terminal of an agent must have this size (revision 4; sent only to a runner that announced it). */
export const agentResizeFrame = frame("agent.resize", {
  instanceId,
  cols: terminalCells(MAX_TERMINAL_COLS),
  rows: terminalCells(MAX_TERMINAL_ROWS),
});

export const callResultFrame = frame("call.result", {
  callId: requestId,
  ok: z.boolean(),
  /** The tool's return value when `ok`. */
  result: z.unknown().optional(),
  error: errorSchema.optional(),
});

export const serverFrameSchema = z.discriminatedUnion("type", [
  registeredFrame,
  rejectFrame,
  serverHeartbeatFrame,
  agentStartFrame,
  agentDeliverFrame,
  agentStopFrame,
  agentInputFrame,
  agentResizeFrame,
  callResultFrame,
]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;

export type RegisterFrame = z.infer<typeof registerFrame>;
export type RegisteredFrame = z.infer<typeof registeredFrame>;
export type RejectFrame = z.infer<typeof rejectFrame>;
export type AgentStateFrame = z.infer<typeof agentStateFrame>;
export type AgentOutputFrame = z.infer<typeof agentOutputFrame>;
export type AgentDeltaFrame = z.infer<typeof agentDeltaFrame>;
export type CallFrame = z.infer<typeof callFrame>;
export type ResponseFrame = z.infer<typeof responseFrame>;
export type AgentStartFrame = z.infer<typeof agentStartFrame>;
export type AgentDeliverFrame = z.infer<typeof agentDeliverFrame>;
export type AgentStopFrame = z.infer<typeof agentStopFrame>;
export type AgentInputFrame = z.infer<typeof agentInputFrame>;
export type AgentResizeFrame = z.infer<typeof agentResizeFrame>;
export type AgentResizedFrame = z.infer<typeof agentResizedFrame>;
export type CallResultFrame = z.infer<typeof callResultFrame>;
/** The requests of the server that the runner answers with a `response`. */
export type RequestFrame = AgentStartFrame | AgentDeliverFrame | AgentStopFrame;
