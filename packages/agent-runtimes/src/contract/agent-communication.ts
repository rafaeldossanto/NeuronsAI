import type { AgentPeers } from "@neurons/graph-schema";
import type { ToolCallReport } from "./tool-call.js";
import type { AgentUsage } from "./usage.js";

/**
 * The communication tools every agent has, already bound to its run and name. Runtimes expose
 * them to the model (`send_message`, `ask`, `reply`, `list_peers`, `finish`).
 */
export interface AgentCommunication {
  /** Fire and forget: resolves as soon as the message is stored. */
  sendMessage(to: string, text: string): Promise<{ messageId: string }>;

  /** Resolves with the answer text; rejects with `AskTimeoutError` when nobody answers in time. */
  ask(to: string, question: string, options?: { timeoutMs?: number }): Promise<string>;

  /** Answers a message received earlier; goes to whoever wrote it. */
  reply(messageId: string, text: string): Promise<{ messageId: string }>;

  /** Synchronous when the Hub is in this process; a runner hosted elsewhere has to ask for it. */
  listPeers(): AgentPeers | Promise<AgentPeers>;

  /** Declares the whole run done. */
  finish(result: string): Promise<void>;

  /** Records what a turn consumed (only runtimes that learn it call this). */
  reportUsage(usage: AgentUsage): Promise<void>;

  /** Records that the agent called a tool (not one of these): it enters the run log as `ToolCalled`. */
  reportToolCall(report: ToolCallReport): Promise<void>;

  /** Only graph-authorized tools; optional for older runtimes and protocol revisions. */
  listTools?(): Promise<
    { nodeId: string; name: string; description: string; inputSchema: Record<string, unknown> }[]
  >;
  useTool?(nodeId: string, name: string, input: Record<string, unknown>): Promise<unknown>;
}
