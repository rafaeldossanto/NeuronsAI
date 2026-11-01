import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

export const uniqueIds: ValidationRule = ({ graph }) => {
  const seen = new Set<string>();
  const issues: GraphIssue[] = [];
  const collections = [
    ["nodes", graph.nodes],
    ["links", graph.links],
    ["annotations", graph.annotations],
  ] as const;

  for (const [collection, items] of collections) {
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        issues.push(
          createIssue("duplicate_id", `O identificador "${item.id}" está repetido no grafo.`, {
            path: [collection, index, "id"],
          }),
        );
      }
      seen.add(item.id);
    });
  }
  return issues;
};
