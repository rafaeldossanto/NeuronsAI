import type { AgentPeers } from "@neurons/graph-schema";
import type { AgentCommunication } from "../agents/agent-communication.js";
import type { Hub } from "./hub.js";

/** The communication tools of one agent of one run, backed by the Hub. */
export class HubAgentCommunication implements AgentCommunication {
  constructor(
    private readonly hub: Hub,
    private readonly runId: string,
    private readonly agent: string,
  ) {}

  async sendMessage(to: string, text: string): Promise<{ messageId: string }> {
    const message = await this.hub.send(this.runId, this.agent, to, "message", text);
    return { messageId: message.id };
  }

  ask(to: string, question: string, options?: { timeoutMs?: number }): Promise<string> {
    return this.hub.ask(this.runId, this.agent, to, question, options?.timeoutMs);
  }

  async reply(messageId: string, text: string): Promise<{ messageId: string }> {
    const message = await this.hub.reply(this.runId, this.agent, messageId, text);
    return { messageId: message.id };
  }

  listPeers(): AgentPeers {
    return this.hub.listPeers(this.runId, this.agent);
  }

  finish(result: string): Promise<void> {
    return this.hub.finish(this.runId, this.agent, result);
  }
}
