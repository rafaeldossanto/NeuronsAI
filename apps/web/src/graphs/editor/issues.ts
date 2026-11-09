import { validateGraph, type GraphIssue } from "@neurons/graph-schema";
import type { GraphDoc } from "./model";

export interface LocatedIssue extends GraphIssue {
  /** The block the issue belongs to, when it can be placed on the canvas. */
  targetNodeId?: string;
  /** The arrow the issue belongs to. */
  targetLinkId?: string;
}

/** Runs `validateGraph` and works out which block or arrow each issue sits on (the path names an index). */
export function validateDoc(doc: GraphDoc): LocatedIssue[] {
  const result = validateGraph(doc);
  if (result.ok) return [];
  return result.issues.map((issue) => {
    const [section, index] = issue.path ?? [];
    const node = section === "nodes" && typeof index === "number" ? doc.nodes[index] : undefined;
    const link = section === "links" && typeof index === "number" ? doc.links[index] : undefined;
    const located: LocatedIssue = { ...issue };
    const targetNodeId = issue.nodeId ?? node?.id;
    const targetLinkId = issue.linkId ?? link?.id;
    if (targetNodeId !== undefined) located.targetNodeId = targetNodeId;
    if (targetLinkId !== undefined) located.targetLinkId = targetLinkId;
    return located;
  });
}

/** Where the issue's field lives inside its block, for the list (e.g. "runtime.model"). */
export function issueField(issue: GraphIssue): string | null {
  const rest = (issue.path ?? []).slice(2);
  return rest.length > 0 ? rest.join(".") : null;
}
