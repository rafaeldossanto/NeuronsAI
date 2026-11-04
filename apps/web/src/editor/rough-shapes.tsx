import type { Annotation } from "@neurons/graph-schema";
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import { useMemo } from "react";
import { INK, seedOf } from "./annotations";

const generator = rough.generator();

interface DrawnPath {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

const PAD = 3;

function pathsOf(drawable: ReturnType<typeof generator.line>): DrawnPath[] {
  return generator.toPaths(drawable).map((path) => ({
    d: path.d,
    stroke: path.stroke,
    strokeWidth: path.strokeWidth,
    fill: path.fill ?? "none",
  }));
}

/** The hand-drawn strokes of an annotation, as plain SVG path data (no DOM work, no inline script). */
export function drawAnnotation(annotation: Annotation, width: number, height: number): DrawnPath[] {
  const stroke = String(annotation.style?.["stroke"] ?? INK.grafite);
  const fill = annotation.style?.["fill"];
  const options: Options = {
    seed: seedOf(annotation.id),
    stroke,
    strokeWidth: annotation.kind === "group" ? 1.5 : 2,
    roughness: 1.2,
    ...(typeof fill === "string"
      ? { fill, fillStyle: annotation.kind === "note" ? "solid" : "hachure", fillWeight: 1.5 }
      : {}),
  };
  switch (annotation.kind) {
    case "ellipse":
      return pathsOf(
        generator.ellipse(width / 2, height / 2, width - PAD * 2, height - PAD * 2, options),
      );
    case "arrow": {
      const points = annotation.points ?? [];
      const start = points[0];
      const end = points.at(-1);
      if (!start || !end || points.length < 2) return [];
      const before = points.at(-2) ?? start;
      const angle = Math.atan2(end.y - before.y, end.x - before.x);
      const wing = (side: number): [number, number] => [
        end.x - 14 * Math.cos(angle + side),
        end.y - 14 * Math.sin(angle + side),
      ];
      return [
        ...pathsOf(
          generator.linearPath(
            points.map((p): [number, number] => [p.x, p.y]),
            options,
          ),
        ),
        ...pathsOf(generator.linearPath([wing(0.45), [end.x, end.y], wing(-0.45)], options)),
      ];
    }
    default:
      return pathsOf(generator.rectangle(PAD, PAD, width - PAD * 2, height - PAD * 2, options));
  }
}

export function RoughSvg({
  annotation,
  width,
  height,
  hit = "stroke",
}: {
  annotation: Annotation;
  width: number;
  height: number;
  /** What a click on the drawing hits: only the strokes, or also the filled area. */
  hit?: "stroke" | "all";
}) {
  const paths = useMemo(
    () => drawAnnotation(annotation, width, height),
    // The drawing depends on these fields only (not on the text).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [annotation.id, annotation.kind, annotation.style, annotation.points, width, height],
  );
  return (
    <svg
      width={width}
      height={height}
      className="absolute inset-0 overflow-visible"
      style={{ pointerEvents: "none" }}
      aria-hidden
    >
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          fill={path.fill}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...(annotation.kind === "group" ? { strokeDasharray: "8 6" } : {})}
          style={{ pointerEvents: hit === "all" ? "all" : "visibleStroke" }}
        />
      ))}
      {/* A wider invisible stroke makes thin lines easy to grab. */}
      {paths.slice(0, 1).map((path) => (
        <path
          key="hit"
          d={path.d}
          stroke="transparent"
          strokeWidth={14}
          fill="none"
          style={{ pointerEvents: "stroke" }}
        />
      ))}
    </svg>
  );
}
