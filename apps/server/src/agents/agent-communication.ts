import type { AgentPeers } from "@neurons/graph-schema";

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

  listPeers(): AgentPeers;

  /** Declares the whole run done. */
  finish(result: string): Promise<void>;
}
