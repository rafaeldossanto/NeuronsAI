import { memo } from "react";
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { EdgePulse } from "@/runs/live/pulse-edges";
import { PULSE_TTL_MS } from "@/runs/live/pulse-edges";
import { INK } from "./annotations";

export type PulseEdgeData = Record<string, unknown> & { pulses?: EdgePulse[] };
export type PulseEdgeType = Edge<PulseEdgeData, "pulse">;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The arrow of the run view. It draws the same line as the editor's arrow; each message adds an
 * amber dot that travels the line once, from the sender to the recipient (SMIL `animateMotion`, so
 * it costs no JavaScript per frame and no re-render; with reduced motion the dot just sits on the middle of the line). While a dot runs, the line itself turns amber.
 */
export const PulseEdge = memo(function PulseEdge(props: EdgeProps<PulseEdgeType>) {
  const [path, midX, midY] = getBezierPath(props);
  const pulses = props.data?.pulses ?? [];
  const calm = reducedMotion();
  const seconds = PULSE_TTL_MS / 1000 - 0.3;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
        {...(props.markerStart ? { markerStart: props.markerStart } : {})}
        style={{ ...props.style, ...(pulses.length > 0 ? { stroke: INK.ambar } : {}) }}
      />
      {pulses.map((pulse) => (
        <g key={pulse.seq} data-testid="pulse" data-reverse={pulse.reverse || undefined}>
          <circle r={9} fill={INK.ambar} opacity={0.3} {...(calm ? { cx: midX, cy: midY } : {})}>
            {!calm && <Motion path={path} reverse={pulse.reverse} seconds={seconds} />}
          </circle>
          <circle r={5} fill={INK.ambar} {...(calm ? { cx: midX, cy: midY } : {})}>
            {!calm && <Motion path={path} reverse={pulse.reverse} seconds={seconds} />}
          </circle>
        </g>
      ))}
    </>
  );
});

function Motion({ path, reverse, seconds }: { path: string; reverse: boolean; seconds: number }) {
  return (
    <animateMotion
      path={path}
      dur={`${seconds}s`}
      repeatCount={1}
      fill="freeze"
      calcMode="linear"
      keyPoints={reverse ? "1;0" : "0;1"}
      keyTimes="0;1"
    />
  );
}

export const edgeTypes = { pulse: PulseEdge };
