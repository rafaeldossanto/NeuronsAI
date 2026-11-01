import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

export const groupMembersExist: ValidationRule = ({ graph, nodesById }) => {
  const issues: GraphIssue[] = [];

  graph.annotations.forEach((annotation, index) => {
    if (annotation.kind !== "group") return;
    annotation.memberIds?.forEach((memberId, memberIndex) => {
      if (!nodesById.has(memberId)) {
        issues.push(
          createIssue("group_member_not_found", "O grupo contém um bloco que não existe.", {
            path: ["annotations", index, "memberIds", memberIndex],
          }),
        );
      }
    });
  });
  return issues;
};
