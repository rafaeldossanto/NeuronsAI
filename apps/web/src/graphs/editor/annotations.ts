import type { Annotation, Position, Size } from "@neurons/graph-schema";
import type { GraphDoc } from "./model";

/** The free layer's drawing tools plus "select" (the default: no drawing). */
export type Tool = "select" | "rect" | "ellipse" | "arrow" | "text" | "note" | "group";
export type AnnotationKind = Exclude<Tool, "select">;

export const TOOLS: readonly { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Selecionar", key: "v" },
  { tool: "rect", label: "Retângulo", key: "r" },
  { tool: "ellipse", label: "Elipse", key: "o" },
  { tool: "arrow", label: "Seta livre", key: "a" },
  { tool: "text", label: "Texto", key: "t" },
  { tool: "note", label: "Nota", key: "n" },
  { tool: "group", label: "Grupo", key: "g" },
];

/** Colors of the free layer (hex, since they are saved in `style` and drawn by roughjs). */
export const INK = { grafite: "#1d1f26", ambar: "#e9a15c", cinza: "#73747f" } as const;
export const NOTE_FILL = "#f6ddbd";
export const SOFT_FILL = "#f3cfa1";
export const DEFAULT_FONT_SIZE = 16;

/** Size assumed for a block the canvas has not measured yet. */
export const NODE_FALLBACK: Size = { width: 208, height: 72 };
const MIN_DRAG = 8;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const isAnnotationId = (doc: GraphDoc, id: string) =>
  doc.annotations.some((annotation) => annotation.id === id);

/** Arrows keep their points relative to `position`; the box is what they span. */
function arrowSize(points: readonly Position[]): Size {
  const width = Math.max(1, ...points.map((p) => p.x));
  const height = Math.max(1, ...points.map((p) => p.y));
  return { width, height };
}

function textSize(annotation: Annotation): Size {
  const fontSize = Number(annotation.style?.["fontSize"] ?? DEFAULT_FONT_SIZE);
  const lines = (annotation.text ?? "").split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return { width: longest * fontSize * 0.6 + 8, height: lines.length * fontSize * 1.4 + 4 };
}

export function annotationSize(annotation: Annotation): Size {
  if (annotation.size) return annotation.size;
  if (annotation.kind === "arrow" && annotation.points) return arrowSize(annotation.points);
  return textSize(annotation);
}

/** The area an item (block or annotation) takes on the canvas. */
export function itemBox(
  doc: GraphDoc,
  id: string,
  measured: Record<string, Size> = {},
): Box | null {
  const node = doc.nodes.find((n) => n.id === id);
  if (node) return { ...node.position, ...(measured[id] ?? NODE_FALLBACK) };
  const annotation = doc.annotations.find((a) => a.id === id);
  return annotation ? { ...annotation.position, ...annotationSize(annotation) } : null;
}

export function normalizeBox(a: Position, b: Position): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/** Ids of the blocks and annotations that fit entirely inside `box` (what a new group wraps). */
export function itemsInside(doc: GraphDoc, box: Box, measured: Record<string, Size> = {}) {
  return [...doc.nodes, ...doc.annotations].flatMap((item) => {
    const itemArea = itemBox(doc, item.id, measured);
    return itemArea && contains(box, itemArea) ? [item.id] : [];
  });
}

const DEFAULT_SIZE: Record<"rect" | "ellipse" | "note" | "group", Size> = {
  rect: { width: 160, height: 100 },
  ellipse: { width: 160, height: 100 },
  note: { width: 180, height: 120 },
  group: { width: 320, height: 200 },
};

/**
 * Builds the annotation a drag from `from` to `to` draws. A click (almost no drag) gives the tool's
 * default size. Groups wrap what ends up inside them.
 */
export function createAnnotation(
  kind: AnnotationKind,
  id: string,
  from: Position,
  to: Position,
  doc: GraphDoc,
  measured: Record<string, Size> = {},
): Annotation {
  const dragged = Math.hypot(to.x - from.x, to.y - from.y) >= MIN_DRAG;
  const box = normalizeBox(from, to);
  const stroke = { stroke: INK.grafite };
  switch (kind) {
    case "arrow": {
      const end = dragged ? to : { x: from.x + 120, y: from.y };
      const origin = { x: Math.min(from.x, end.x), y: Math.min(from.y, end.y) };
      return {
        id,
        kind,
        position: origin,
        points: [
          { x: from.x - origin.x, y: from.y - origin.y },
          { x: end.x - origin.x, y: end.y - origin.y },
        ],
        style: stroke,
      };
    }
    case "text":
      return {
        id,
        kind,
        position: from,
        text: "Texto",
        style: { ...stroke, fontSize: DEFAULT_FONT_SIZE },
      };
    case "note":
    case "rect":
    case "ellipse":
    case "group": {
      const size = dragged ? { width: box.width, height: box.height } : DEFAULT_SIZE[kind];
      const position = dragged ? { x: box.x, y: box.y } : from;
      const annotation: Annotation = { id, kind, position, size };
      if (kind === "note") {
        return {
          ...annotation,
          text: "Nota",
          style: { stroke: INK.ambar, fill: NOTE_FILL, fontSize: DEFAULT_FONT_SIZE },
        };
      }
      if (kind === "group") {
        const members = itemsInside(doc, { ...position, ...size }, measured);
        return { ...annotation, text: "Grupo", memberIds: members, style: { stroke: INK.cinza } };
      }
      return { ...annotation, style: stroke };
    }
  }
}

/** A stable positive number from an id, so the hand-drawn wobble does not change between renders. */
export function seedOf(id: string): number {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  return hash + 1;
}
