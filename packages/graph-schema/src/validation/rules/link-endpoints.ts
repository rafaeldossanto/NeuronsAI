import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

const ENDPOINT_SIDES = ["from", "to"] as const;

export const linkEndpointsExist: ValidationRule = ({ graph, nodesById }) => {
  const issues: GraphIssue[] = [];

  graph.links.forEach((link, index) => {
    for (const side of ENDPOINT_SIDES) {
      if (!nodesById.has(link[side])) {
        issues.push(
          createIssue("link_endpoint_not_found", "A ligação aponta para um bloco que não existe.", {
            path: ["links", index, side],
            linkId: link.id,
          }),
        );
      }
    }
  });
  return issues;
};

export const linkEndpointTypesMatchKind: ValidationRule = ({ graph, nodesById }) => {
  const issues: GraphIssue[] = [];

  graph.links.forEach((link, index) => {
    const from = nodesById.get(link.from);
    const to = nodesById.get(link.to);
    if (!from || !to) return; // reported by linkEndpointsExist
    const location = { path: ["links", index], linkId: link.id };

    if (link.kind === "talk") {
      if (from.type !== "agent" || to.type !== "agent") {
        issues.push(
          createIssue("talk_requires_agents", "Uma conversa só pode ligar dois agentes.", location),
        );
      } else if (from.id === to.id) {
        issues.push(
          createIssue(
            "talk_to_self",
            "Um agente não pode ter uma conversa consigo mesmo.",
            location,
          ),
        );
      }
    } else if (from.type !== "agent" || to.type !== "tool") {
      issues.push(
        createIssue(
          "uses_requires_agent_to_tool",
          "O uso de ferramenta deve ligar um agente a uma ferramenta.",
          location,
        ),
      );
    }
  });
  return issues;
};
