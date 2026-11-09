import type { GraphDefinition } from "@neurons/graph-schema";
import { describe, expect, it } from "vitest";
import { pulsesByEdge } from "./pulse-edges";

const agent = (id: string, name: string) => ({
  id,
  type: "agent" as const,
  position: { x: 0, y: 0 },
  name,
  role: "r",
  instructions: "i",
  effort: "low" as const,
  runtime: { kind: "api" as const, provider: "anthropic", model: "m" },
});

const doc: Pick<GraphDefinition, "nodes" | "links"> = {
  nodes: [
    { id: "g", type: "trigger", position: { x: 0, y: 0 }, kind: "manual", target: "a" },
    agent("a", "Pesquisador"),
    agent("b", "Revisor"),
  ],
  links: [{ id: "l1", from: "a", to: "b", kind: "talk", bidirectional: true, maxMessages: 10 }],
};

const pulse = (seq: number, from: string, to: string) => ({
  seq,
  from,
  to,
  kind: "message" as const,
});

describe("pulsesByEdge", () => {
  it("anda no sentido de quem mandou, ligando bloco e agente pelo nome", () => {
    expect(
      pulsesByEdge(doc, [pulse(1, "Pesquisador", "Revisor"), pulse(2, "Revisor", "Pesquisador")]),
    ).toEqual({
      l1: [
        { seq: 1, reverse: false },
        { seq: 2, reverse: true },
      ],
    });
  });

  it("o gatilho corre pela seta que aponta para o destinatário", () => {
    expect(pulsesByEdge(doc, [pulse(1, "@trigger", "Pesquisador")])).toEqual({
      "trigger:g": [{ seq: 1, reverse: false }],
    });
  });

  it("deixa de fora @human, agentes desconhecidos e pares sem seta", () => {
    expect(
      pulsesByEdge(doc, [
        pulse(1, "@human", "Revisor"),
        pulse(2, "Fantasma", "Revisor"),
        pulse(3, "Revisor", "Revisor"),
      ]),
    ).toEqual({});
  });
});
