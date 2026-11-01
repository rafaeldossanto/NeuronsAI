import type { AgentNode, GraphDefinition } from "@neurons/graph-schema";

export const findAgent = (graph: GraphDefinition, name: string): AgentNode | undefined =>
  graph.nodes.find((node): node is AgentNode => node.type === "agent" && node.name === name);
