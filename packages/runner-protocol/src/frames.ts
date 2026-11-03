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
]);
export type Call = z.infer<typeof callSchema>;

// ---- runner -> server ----

export const registerFrame = frame("register", {
  runner: z.object({
    name: z.string().min(1).max(100),
    platform: z.string().max(50).optional(),
  }),
  capabilities: z.object({ terminal: z.boolean(), streamJson: z.boolean() }),
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

/** The runner's answer to a request of the server (`agent.start`, `agent.deliver`, `agent.stop`). */
export const responseFrame = frame("response", {
  requestId,
  ok: z.boolean(),
  error: errorSchema.optional(),
});

export const runnerFrameSchema = z.discriminatedUnion("type", [
  registerFrame,
  runnerHeartbeatFrame,
  agentStateFrame,
  agentOutputFrame,
  callFrame,
  responseFrame,
]);
export type RunnerFrame = z.infer<typeof runnerFrameSchema>;

// ---- server -> runner ----

export const registeredFrame = frame("registered", {
  runnerId: z.string().min(1),
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
});

export const agentDeliverFrame = frame("agent.deliver", {
  requestId,
  instanceId,
  message: inboundMessageSchema,
});

export const agentStopFrame = frame("agent.stop", { requestId, instanceId });

/** The user typed into an agent's terminal. */
export const agentInputFrame = frame("agent.input", { instanceId, data: z.string() });

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
  callResultFrame,
]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;

export type RegisterFrame = z.infer<typeof registerFrame>;
export type RegisteredFrame = z.infer<typeof registeredFrame>;
export type RejectFrame = z.infer<typeof rejectFrame>;
export type AgentStateFrame = z.infer<typeof agentStateFrame>;
export type AgentOutputFrame = z.infer<typeof agentOutputFrame>;
export type CallFrame = z.infer<typeof callFrame>;
export type ResponseFrame = z.infer<typeof responseFrame>;
export type AgentStartFrame = z.infer<typeof agentStartFrame>;
export type AgentDeliverFrame = z.infer<typeof agentDeliverFrame>;
export type AgentStopFrame = z.infer<typeof agentStopFrame>;
export type AgentInputFrame = z.infer<typeof agentInputFrame>;
export type CallResultFrame = z.infer<typeof callResultFrame>;
/** The requests of the server that the runner answers with a `response`. */
export type RequestFrame = AgentStartFrame | AgentDeliverFrame | AgentStopFrame;
