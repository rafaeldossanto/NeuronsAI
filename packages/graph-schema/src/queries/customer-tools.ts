import type { GraphDefinition } from "../schemas/graph.js";
import type { Link } from "../schemas/link.js";
import type { ToolNode } from "../schemas/node.js";
import { findAgentByName } from "./agents.js";

/**
 * Whether the tool can change something outside the run, through this link. A memory is a writer
 * unless the block or the link makes it read-only; an HTTP tool is one unless it is a GET; an MCP
 * server is always taken as one (its tools are not known before it is started). The WhatsApp
 * reply is not counted: it is what the customer's agent is for, and it can only answer that customer.
 */
export function isWriteTool(node: ToolNode, link?: Pick<Link, "readOnly">): boolean {
  switch (node.tool.kind) {
    case "obsidian":
      return !node.tool.readOnly && link?.readOnly !== true;
    case "http":
      return node.tool.method !== "GET";
    case "mcp":
      return true;
    case "whatsapp":
      return false;
  }
}

/** Whether the agent is the target of a WhatsApp trigger, so customers write to it. */
export function readsCustomerMessages(graph: GraphDefinition, agentId: string): boolean {
  return graph.nodes.some(
    (node) => node.type === "trigger" && node.kind === "whatsapp" && node.target === agentId,
  );
}

/**
 * The tools linked to the agent that it must not use: it reads what customers write, the tool can
 * write, and the `uses` link does not say `allowWrite`. Enforced by the server when it lists and
 * runs tools; shown as a warning in the editor.
 */
export function writeToolsBlockedFor(graph: GraphDefinition, agentName: string): ToolNode[] {
  const agent = findAgentByName(graph, agentName);
  if (!agent || !readsCustomerMessages(graph, agent.id)) return [];

  const blocked: ToolNode[] = [];
  for (const link of graph.links) {
    if (link.kind !== "uses" || link.from !== agent.id || link.allowWrite === true) continue;
    const node = graph.nodes.find(
      (candidate): candidate is ToolNode => candidate.type === "tool" && candidate.id === link.to,
    );
    if (node && isWriteTool(node, link) && !blocked.includes(node)) blocked.push(node);
  }
  return blocked;
}
