import type { Link } from "../../schemas/link.js";
import { createIssue, type GraphIssue } from "../issue.js";
import type { ValidationRule } from "../context.js";

const unorderedPairKey = (link: Link) => [link.from, link.to].sort().join("|");

/** Whether two links of the same kind between the same pair of blocks clash. */
function conflicts(earlier: Link, later: Link): boolean {
  const sameDirection = earlier.from === later.from;
  if (earlier.kind === "uses") return sameDirection;
  return sameDirection || earlier.bidirectional || later.bidirectional;
}

export const noDuplicateLinks: ValidationRule = ({ graph }) => {
  const issues: GraphIssue[] = [];
  const seenByPair = new Map<string, Link[]>();

  graph.links.forEach((link, index) => {
    if (link.from === link.to) return; // reported by linkEndpointTypesMatchKind
    const key = `${link.kind}:${unorderedPairKey(link)}`;
    const earlier = seenByPair.get(key) ?? [];

    if (earlier.some((other) => conflicts(other, link))) {
      issues.push(
        createIssue(
          "duplicate_link",
          "Já existe uma ligação do mesmo tipo entre esses dois blocos.",
          { path: ["links", index], linkId: link.id },
        ),
      );
    }
    seenByPair.set(key, [...earlier, link]);
  });
  return issues;
};
