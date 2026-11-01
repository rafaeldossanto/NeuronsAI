import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

export const hasTrigger: ValidationRule = ({ graph }) =>
  graph.nodes.some((node) => node.type === "trigger")
    ? []
    : [
        createIssue("missing_trigger", "O grafo precisa de pelo menos um gatilho.", {
          path: ["nodes"],
        }),
      ];

export const triggerTargetsAreAgents: ValidationRule = ({ graph, nodesById }) => {
  const issues: GraphIssue[] = [];

  graph.nodes.forEach((node, index) => {
    if (node.type !== "trigger") return;
    const location = { path: ["nodes", index, "target"], nodeId: node.id };
    const target = nodesById.get(node.target);

    if (!target) {
      issues.push(
        createIssue(
          "trigger_target_not_found",
          "O gatilho aponta para um agente que não existe.",
          location,
        ),
      );
    } else if (target.type !== "agent") {
      issues.push(
        createIssue("trigger_target_not_agent", "O gatilho só pode iniciar um agente.", location),
      );
    }
  });
  return issues;
};
