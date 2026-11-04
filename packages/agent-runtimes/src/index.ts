// The contract between the Hub and the agent runtimes. Free of NestJS, of the database and of any
// native dependency: a separate runner process (T24) can implement or host these as they are.
export { AGENT_RUNTIME_STATES } from "./contract/agent-runtime.js";
export type {
  AgentRuntime,
  AgentRuntimeState,
  InboundMessage,
  InboundMessageKind,
} from "./contract/agent-runtime.js";
export type { AgentCommunication } from "./contract/agent-communication.js";
export { UnsupportedRuntimeError } from "./contract/agent-runtime-factory.js";
export type { AgentRuntimeFactory } from "./contract/agent-runtime-factory.js";
export { silentLogger } from "./contract/logger.js";
export type { RuntimeLogger } from "./contract/logger.js";
export { Signal } from "./contract/signal.js";
export type { Unsubscribe } from "./contract/signal.js";
export { DEFAULT_OUTPUT_BUFFER_CHARS, OutputBuffer } from "./claude/output-buffer.js";
export { isTerminalRuntime } from "./contract/terminal-runtime.js";
export type { TerminalAgentRuntime } from "./contract/terminal-runtime.js";
export type { ToolCallReport } from "./contract/tool-call.js";
export { DEFAULT_USAGE_FLUSH_MS } from "./contract/usage.js";
export type { AgentUsage } from "./contract/usage.js";
