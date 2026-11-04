import { z } from "zod";

/**
 * The wire contract between the `neurons` MCP server (a child of the agent's CLI) and the local
 * bridge each runtime opens on 127.0.0.1. Both sides import it from here, so it cannot drift.
 */
export const BRIDGE_ROUTES = {
  sendMessage: "/tools/send_message",
  ask: "/tools/ask",
  reply: "/tools/reply",
  listPeers: "/tools/list_peers",
  finish: "/tools/finish",
  listTools: "/tools/list_tools",
  useTool: "/tools/use_tool",
  /** Notices posted by the CLI's own hooks (Claude Code HTTP hooks), not by the MCP server. */
  hooks: {
    userPromptSubmit: "/hooks/user-prompt-submit",
    stop: "/hooks/stop",
  },
} as const;

export const BRIDGE_TOKEN_MIN_LENGTH = 32;

/** The name of the MCP server, hence the prefix of its tools (`mcp__neurons__ask`...). */
export const MCP_SERVER_NAME = "neurons";

export const COMMUNICATION_TOOLS = [
  "send_message",
  "ask",
  "reply",
  "list_peers",
  "finish",
  "list_tools",
  "use_tool",
] as const;
export type CommunicationTool = (typeof COMMUNICATION_TOOLS)[number];

/** How the CLI names the tools of this server; used to pre-approve exactly these and nothing else. */
export const mcpToolName = (tool: CommunicationTool): string => `mcp__${MCP_SERVER_NAME}__${tool}`;

const text = z.string().min(1);

export const sendMessageRequest = z.object({ to: text, text });
export const askRequest = z.object({ to: text, question: text });
export const replyRequest = z.object({ messageId: text, text });
export const finishRequest = z.object({ result: z.string() });

export const sendMessageResponse = z.object({ messageId: text });
export const askResponse = z.object({ answer: z.string() });
export const replyResponse = sendMessageResponse;
export const finishResponse = z.object({});
export const useToolRequest = z.object({
  nodeId: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});
export const graphToolsResponse = z.array(
  z.object({
    nodeId: z.string(),
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
  }),
);
export const graphToolResponse = z.unknown();

const agentRef = z.object({ id: z.string(), name: z.string(), role: z.string() });
export const listPeersResponse = z.object({
  canMessage: z.array(agentRef),
  canBeMessagedBy: z.array(agentRef),
});

/** Body of every failed bridge call; `error` is already written for the model to read. */
export const bridgeErrorResponse = z.object({ error: z.string() });

export type SendMessageRequest = z.infer<typeof sendMessageRequest>;
export type AskRequest = z.infer<typeof askRequest>;
export type ReplyRequest = z.infer<typeof replyRequest>;
export type FinishRequest = z.infer<typeof finishRequest>;
export type ListPeersResponse = z.infer<typeof listPeersResponse>;
