import type { GraphDefinition } from "../schemas/graph.js";
import type { AgentNode } from "../schemas/node.js";

export const isAgent = (node: GraphDefinition["nodes"][number]): node is AgentNode =>
  node.type === "agent";

/** Agent names are unique ignoring case, so the lookup is case-insensitive. */
export function findAgentByName(graph: GraphDefinition, agentName: string): AgentNode | undefined {
  const wanted = agentName.toLowerCase();
  return graph.nodes.filter(isAgent).find((agent) => agent.name.toLowerCase() === wanted);
}
