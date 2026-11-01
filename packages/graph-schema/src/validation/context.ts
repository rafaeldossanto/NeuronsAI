import type { GraphDefinition } from "../schemas/graph.js";
import type { GraphNode } from "../schemas/node.js";
import type { GraphIssue } from "./issue.js";

export interface RuleContext {
  graph: GraphDefinition;
  nodesById: ReadonlyMap<string, GraphNode>;
}

export type ValidationRule = (context: RuleContext) => GraphIssue[];

export function createRuleContext(graph: GraphDefinition): RuleContext {
  return { graph, nodesById: new Map(graph.nodes.map((node) => [node.id, node])) };
}
