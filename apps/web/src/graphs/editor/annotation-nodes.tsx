import type { Annotation, Position, Size } from "@neurons/graph-schema";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/shared/utils";
import { annotationSize, DEFAULT_FONT_SIZE, INK } from "./annotations";
import { RoughSvg } from "./rough-shapes";

export interface AnnotationData extends Record<string, unknown> {
  annotation: Annotation;
  onResizeStart: () => void;
  onResize: (id: string, position: Position, size: Size) => void;
  onResizeEnd: () => void;
}

export type AnnotationNode = Node<AnnotationData>;

const fontSizeOf = (annotation: Annotation) =>
  Number(annotation.style?.["fontSize"] ?? DEFAULT_FONT_SIZE);
const inkOf = (annotation: Annotation) => String(annotation.style?.["stroke"] ?? INK.grafite);

function Resizer({ data, selected }: { data: AnnotationData; selected: boolean | undefined }) {
  return (
    <NodeResizer
      isVisible={Boolean(selected)}
      minWidth={40}
      minHeight={30}
      color={INK.ambar}
      onResizeStart={data.onResizeStart}
      onResize={(_, params) =>
        data.onResize(
          data.annotation.id,
          { x: params.x, y: params.y },
          { width: params.width, height: params.height },
        )
      }
      onResizeEnd={data.onResizeEnd}
    />
  );
}

/** Rectangle, ellipse and note: a hand-drawn outline with the text in the middle. */
function Shape({ data, selected }: NodeProps<AnnotationNode>) {
  const { annotation } = data;
  const { width, height } = annotationSize(annotation);
  const isNote = annotation.kind === "note";
  return (
    <div
      data-testid={`annotation-${annotation.id}`}
      data-kind={annotation.kind}
      className="relative"
      style={{ width, height }}
    >
      <Resizer data={data} selected={selected} />
      <RoughSvg
        annotation={annotation}
        width={width}
        height={height}
        hit={isNote ? "all" : "stroke"}
      />
      {annotation.text && (
        <p
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden p-3 text-center font-semibold leading-snug whitespace-pre-wrap break-words",
            isNote && "items-start justify-start text-left",
          )}
          style={{ fontSize: fontSizeOf(annotation), color: INK.grafite }}
        >
          {annotation.text}
        </p>
      )}
    </div>
  );
}

/** A group is a dashed frame; only its outline and label catch the mouse, so blocks inside stay reachable. */
function Group({ data, selected }: NodeProps<AnnotationNode>) {
  const { annotation } = data;
  const { width, height } = annotationSize(annotation);
  return (
    <div
      data-testid={`annotation-${annotation.id}`}
      data-kind="group"
      className="relative"
      style={{ width, height, pointerEvents: "none" }}
    >
      <Resizer data={data} selected={selected} />
      <RoughSvg annotation={annotation} width={width} height={height} />
      <span
        className="pointer-events-auto absolute -top-3 left-3 max-w-[80%] cursor-grab truncate rounded-md bg-background px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide"
        style={{ color: inkOf(annotation) }}
      >
        {annotation.text || "Grupo"}
      </span>
    </div>
  );
}

function Arrow({ data, selected }: NodeProps<AnnotationNode>) {
  const { annotation } = data;
  const { width, height } = annotationSize(annotation);
  return (
    <div
      data-testid={`annotation-${annotation.id}`}
      data-kind="arrow"
      className={cn("relative", selected && "[&_svg]:drop-shadow-[0_0_3px_var(--accent)]")}
      style={{ width, height, pointerEvents: "none" }}
    >
      <RoughSvg annotation={annotation} width={width} height={height} />
    </div>
  );
}

function FreeText({ data, selected }: NodeProps<AnnotationNode>) {
  const { annotation } = data;
  return (
    <p
      data-testid={`annotation-${annotation.id}`}
      data-kind="text"
      className={cn(
        "whitespace-pre-wrap rounded px-1 font-semibold leading-snug",
        selected && "outline-2 outline-dashed outline-accent",
      )}
      style={{ fontSize: fontSizeOf(annotation), color: inkOf(annotation) }}
    >
      {annotation.text || "Texto"}
    </p>
  );
}

/** Prefixed because React Flow styles a built-in node type called "group" (border and background). */
export const annotationNodeType = (kind: Annotation["kind"]) => `free-${kind}`;

export const annotationNodeTypes = {
  "free-rect": Shape,
  "free-ellipse": Shape,
  "free-note": Shape,
  "free-group": Group,
  "free-arrow": Arrow,
  "free-text": FreeText,
};
