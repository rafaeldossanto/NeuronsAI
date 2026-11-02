import type { GraphDefinition } from "../schemas/graph.js";
import type { Link } from "../schemas/link.js";
import { findAgentByName } from "./agents.js";

/**
 * The `talk` link that lets `fromName` start a conversation with `toName`: an arrow from one to the
 * other, or a double arrow. Undefined when there is none (or a name is not an agent).
 */
export function linkBetween(
  graph: GraphDefinition,
  fromName: string,
  toName: string,
): Link | undefined {
  const from = findAgentByName(graph, fromName);
  const to = findAgentByName(graph, toName);
  if (!from || !to) return undefined;
  return graph.links.find(
    (link) =>
      link.kind === "talk" &&
      ((link.from === from.id && link.to === to.id) ||
        (link.bidirectional && link.from === to.id && link.to === from.id)),
  );
}
