import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

/** A group wraps blocks and/or other annotations (even other groups), but never itself. */
export const groupMembersExist: ValidationRule = ({ graph, nodesById }) => {
  const issues: GraphIssue[] = [];
  const annotationIds = new Set(graph.annotations.map((annotation) => annotation.id));

  graph.annotations.forEach((annotation, index) => {
    if (annotation.kind !== "group") return;
    annotation.memberIds?.forEach((memberId, memberIndex) => {
      const exists =
        nodesById.has(memberId) || (annotationIds.has(memberId) && memberId !== annotation.id);
      if (!exists) {
        issues.push(
          createIssue(
            "group_member_not_found",
            "O grupo contém um item (bloco ou anotação) que não existe.",
            { path: ["annotations", index, "memberIds", memberIndex] },
          ),
        );
      }
    });
  });
  return issues;
};
