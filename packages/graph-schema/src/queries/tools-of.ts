import type { GraphDefinition } from "../schemas/graph.js";
import type { ToolNode } from "../schemas/node.js";
import { findAgentByName } from "./agents.js";

/** Tool nodes the agent can use (agent -> tool `uses` links). Unknown name: no tools. */
export function toolsOf(graph: GraphDefinition, agentName: string): ToolNode[] {
  const agent = findAgentByName(graph, agentName);
  if (!agent) return [];

  const toolIds = new Set(
    graph.links
      .filter((link) => link.kind === "uses" && link.from === agent.id)
      .map((link) => link.to),
  );
  return graph.nodes.filter(
    (node): node is ToolNode => node.type === "tool" && toolIds.has(node.id),
  );
}
