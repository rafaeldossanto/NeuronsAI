import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

export const uniqueAgentNames: ValidationRule = ({ graph }) => {
  const seen = new Set<string>();
  const issues: GraphIssue[] = [];

  graph.nodes.forEach((node, index) => {
    if (node.type !== "agent") return;
    const key = node.name.toLowerCase();
    if (seen.has(key)) {
      issues.push(
        createIssue(
          "duplicate_agent_name",
          `Já existe um agente chamado "${node.name}" (nomes não diferenciam maiúsculas de minúsculas).`,
          { path: ["nodes", index, "name"], nodeId: node.id },
        ),
      );
    }
    seen.add(key);
  });
  return issues;
};
