import { render } from "@testing-library/react";
import { Position, type EdgeProps } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PulseEdge, type PulseEdgeType } from "./pulse-edge";

const props = (pulses: { seq: number; reverse: boolean }[]) =>
  ({
    id: "l1",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 100,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: { stroke: "#1d1f26" },
    data: { pulses },
  }) as unknown as EdgeProps<PulseEdgeType>;

const draw = (pulses: { seq: number; reverse: boolean }[]) =>
  render(
    <svg>
      <PulseEdge {...props(pulses)} />
    </svg>,
  );

describe("PulseEdge", () => {
  it("sem mensagens desenha só a seta", () => {
    const { container } = draw([]);
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(container.querySelector("circle")).toBeNull();
  });

  it("um pulso anda do começo ao fim da seta, e ao contrário quando a mensagem vai no sentido oposto", () => {
    const { container } = draw([
      { seq: 1, reverse: false },
      { seq: 2, reverse: true },
    ]);
    const motions = [...container.querySelectorAll("animateMotion")];
    // Two circles (dot and halo) per pulse.
    expect(motions.map((m) => m.getAttribute("keyPoints"))).toEqual(["0;1", "0;1", "1;0", "1;0"]);
    expect(motions[0]?.getAttribute("path")).toMatch(/^M/);
    expect(motions[0]?.getAttribute("repeatCount")).toBe("1");
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("#e9a15c");
  });

  it("a seta fica âmbar enquanto o pulso passa", () => {
    const { container } = draw([{ seq: 1, reverse: false }]);
    const line = container.querySelector("path.react-flow__edge-path");
    expect((line as SVGPathElement).style.stroke).toBe("rgb(233, 161, 92)");
  });
});
