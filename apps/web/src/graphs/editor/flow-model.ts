import { MarkerType, type Edge } from "@xyflow/react";
import type { Annotation } from "@neurons/graph-schema";
import { annotationNodeType } from "./annotation-nodes";
import type { GraphDoc } from "./model";

/** A trigger's arrow is its `target` field, not a link: its edge id starts with this prefix. */
export const TRIGGER_EDGE = "trigger:";

export function edgeColor(invalid: boolean) {
  return invalid ? "var(--destructive)" : "var(--foreground)";
}

/**
 * The arrows of the document: one per link plus one per trigger. Shared by the editor and the
 * read-only run view, so a run is drawn exactly as the graph was drawn.
 */
export function linkFlowEdges(
  doc: Pick<GraphDoc, "nodes" | "links">,
  options: { invalidLinks?: ReadonlySet<string>; selectedLinks?: readonly string[] } = {},
): Edge[] {
  const invalidLinks = options.invalidLinks ?? new Set<string>();
  const selectedLinks = options.selectedLinks ?? [];
  const nodeIds = new Set(doc.nodes.map((node) => node.id));
  const linkEdges: Edge[] = doc.links.map((link) => {
    const color = edgeColor(invalidLinks.has(link.id));
    return {
      id: link.id,
      source: link.from,
      target: link.to,
      selected: selectedLinks.includes(link.id),
      markerEnd: { type: MarkerType.ArrowClosed, color },
      ...(link.bidirectional ? { markerStart: { type: MarkerType.ArrowClosed, color } } : {}),
      style: {
        stroke: color,
        strokeWidth: 1.75,
        ...(link.kind === "uses" ? { strokeDasharray: "6 4" } : {}),
      },
    };
  });
  const triggerEdges: Edge[] = doc.nodes.flatMap((node) => {
    if (node.type !== "trigger" || !nodeIds.has(node.target)) return [];
    const id = `${TRIGGER_EDGE}${node.id}`;
    return [
      {
        id,
        source: node.id,
        target: node.target,
        selected: selectedLinks.includes(id),
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(false) },
        style: { stroke: edgeColor(false), strokeWidth: 1.75 },
      },
    ];
  });
  return [...linkEdges, ...triggerEdges];
}

/**
 * A drawing as a canvas node, without its `data` (the editor wires resize handlers into it, the run
 * view wires nothing). It sits under blocks and arrows (groups under the other annotations); groups
 * and arrows let clicks through to what is below.
 */
export function annotationShell(annotation: Annotation, selected: boolean) {
  return {
    id: annotation.id,
    type: annotationNodeType(annotation.kind),
    position: annotation.position,
    selected,
    zIndex: annotation.kind === "group" ? -2 : -1,
    ...(annotation.kind === "group" || annotation.kind === "arrow"
      ? { style: { pointerEvents: "none" as const } }
      : {}),
  };
}
