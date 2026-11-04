import type { GraphDefinition } from "@neurons/graph-schema";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/two-terminals-demo.json";
import { selectActivity } from "./activity";
import { pulsesByEdge } from "./pulse-edges";
import { reduceRunEvent, initialRunLiveState } from "./reduce-run-event";
import {
  buildReplay,
  CHECKPOINT_EVERY,
  MAX_GAP_MS,
  MIN_GAP_MS,
  pulsesBetween,
  stateAt,
} from "./replay";
import type { RunLiveState, RunLogEvent } from "./types";
import { useReplayPlayer } from "./use-replay-player";

const events = fixture.events as RunLogEvent[];
const replay = buildReplay(events);

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
// The graph of the fixture: a trigger into @Pesquisador and a two-way arrow to @Revisor.
const doc: Pick<GraphDefinition, "nodes" | "links"> = {
  nodes: [
    { id: "g", type: "trigger", position: { x: 0, y: 0 }, kind: "manual", target: "a" },
    agent("a", "Pesquisador"),
    agent("b", "Revisor"),
  ],
  links: [{ id: "l1", from: "a", to: "b", kind: "talk", bidirectional: true, maxMessages: 10 }],
};

const status = (state: RunLiveState, name: string) => state.agents[name]?.status;
const edges = (from: number, to: number) =>
  Object.entries(pulsesByEdge(doc, pulsesBetween(replay, from, to))).map(([edge, list]) => [
    edge,
    list.map((p) => [p.seq, p.reverse]),
  ]);

describe("estado em cada posição do cursor", () => {
  it("dobrar até a posição dá o mesmo estado que o reducer passo a passo", () => {
    let folded = initialRunLiveState;
    expect(stateAt(replay, 0)).toBe(initialRunLiveState);
    events.forEach((event, i) => {
      folded = reduceRunEvent(folded, event);
      expect(stateAt(replay, i + 1)).toEqual(folded);
    });
  });

  it("estados dos agentes, custo e linha do tempo em cada passo", () => {
    const at = (n: number) => stateAt(replay, n);
    expect(at(0).status).toBe("pending");
    expect(at(1).status).toBe("running");
    expect(status(at(3), "Pesquisador")).toBe("starting");
    expect(status(at(4), "Pesquisador")).toBe("busy");
    expect(status(at(5), "Pesquisador")).toBe("waiting_reply");
    expect(status(at(5), "Revisor")).toBe("starting");
    expect(status(at(7), "Revisor")).toBe("busy");
    expect(status(at(9), "Pesquisador")).toBe("busy");
    expect(status(at(10), "Revisor")).toBe("idle");
    expect(at(10).agents["Revisor"]?.costUsd).toBe(0.0123);
    expect(at(9).agents["Revisor"]?.costUsd).toBeNull();
    expect(at(11).status).toBe("succeeded");

    const timeline = (n: number) => selectActivity(at(n)).map((i) => i.seq);
    expect([0, 1, 2, 4, 5, 7, 8, 11].map(timeline)).toEqual([
      [],
      [],
      [2],
      [2],
      [2, 5],
      [2, 5],
      [2, 5, 8],
      [2, 5, 8],
    ]);
  });

  it("voltar e arrastar: ir e voltar leva ao mesmo estado de antes, em qualquer ordem", () => {
    const order = [11, 3, 8, 0, 10, 5, 5, 1, 9];
    for (const n of order) {
      expect(stateAt(replay, n)).toEqual(
        events.slice(0, n).reduce(reduceRunEvent, initialRunLiveState),
      );
    }
    // Out of range is clamped, never throws.
    expect(stateAt(replay, -4)).toBe(initialRunLiveState);
    expect(stateAt(replay, 99)).toEqual(stateAt(replay, 11));
  });
});

describe("pulsos: seta e sentido", () => {
  it("cada mensagem corre pela seta certa, no sentido de quem mandou", () => {
    expect(edges(1, 2)).toEqual([["trigger:g", [[2, false]]]]); // @trigger → Pesquisador
    expect(edges(4, 5)).toEqual([["l1", [[5, false]]]]); // Pesquisador → Revisor, a favor da seta
    expect(edges(7, 8)).toEqual([["l1", [[8, true]]]]); // Revisor → Pesquisador, contra a seta
  });

  it("passos sem mensagem, voltar e saltos grandes não têm pulso", () => {
    expect(edges(2, 3)).toEqual([]);
    expect(edges(5, 4)).toEqual([]); // back
    expect(edges(0, 11)).toEqual([]); // seek
  });
});

describe("tempo e pontos de controle", () => {
  it("encurta as esperas longas e põe piso nas curtas", () => {
    expect(replay.gaps[0]).toBe(0);
    expect(replay.gaps[1]).toBe(MIN_GAP_MS); // 100 ms reais
    expect(replay.gaps[3]).toBe(MAX_GAP_MS); // 3,8 s reais
    expect(replay.shortenedGaps).toBeGreaterThan(0);
    expect(replay.playMs).toBeLessThan(replay.realMs);
    expect(replay.realMs).toBe(7600);
  });

  it("uma execução longa: um ponto de controle a cada N eventos e o mesmo estado de dobrar do zero", () => {
    const long: RunLogEvent[] = [];
    for (let i = 1; i <= CHECKPOINT_EVERY * 3 + 7; i++) {
      long.push({
        seq: i,
        type: "UsageRecorded",
        agent: i % 2 ? "A" : "B",
        payload: { costUsd: 0.01 },
        at: new Date(Date.UTC(2026, 10, 4, 12, 0, i)).toISOString(),
      });
    }
    const big = buildReplay([...long].reverse()); // out of order and with a duplicate
    expect(big.checkpoints).toHaveLength(4);
    for (const n of [0, 49, 50, 51, 100, 149, 150, 157, 3]) {
      expect(stateAt(big, n)).toEqual(long.slice(0, n).reduce(reduceRunEvent, initialRunLiveState));
    }
    expect(buildReplay([...long, long[0]!]).events).toHaveLength(long.length);
  });
});

describe("o player", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => renderHook(() => useReplayPlayer(replay));
  const pulseEdges = (pulses: ReturnType<typeof setup>["result"]["current"]["pulses"]) =>
    Object.entries(pulsesByEdge(doc, pulses)).map(([e, l]) => [e, l.map((p) => p.reverse)]);

  it("avançar e voltar um evento, sem tocar", () => {
    const { result } = setup();
    act(() => result.current.stepForward());
    act(() => result.current.stepForward());
    expect(result.current.position).toBe(2);
    expect(pulseEdges(result.current.pulses)).toEqual([["trigger:g", [false]]]);
    act(() => result.current.stepBack());
    expect(result.current.position).toBe(1);
    expect(result.current.pulses).toEqual([]);
    expect(result.current.state.timeline).toEqual([]);
  });

  it("arrastar a barra para qualquer ponto, para frente e para trás", () => {
    const { result } = setup();
    act(() => result.current.seek(8));
    expect(result.current.pulses).toEqual([]);
    expect(status(result.current.state, "Revisor")).toBe("busy");
    expect(selectActivity(result.current.state).map((i) => i.seq)).toEqual([2, 5, 8]);
    act(() => result.current.seek(3));
    expect(status(result.current.state, "Pesquisador")).toBe("starting");
    expect(selectActivity(result.current.state).map((i) => i.seq)).toEqual([2]);
    act(() => result.current.seek(7));
    act(() => result.current.stepForward()); // event 8: Revisor → Pesquisador, against the arrow
    expect(pulseEdges(result.current.pulses)).toEqual([["l1", [true]]]);
  });

  it("toca pelos horários, com a espera encurtada e dividida pela velocidade", () => {
    const { result } = setup();
    act(() => result.current.toggle());
    act(() => void vi.advanceTimersByTime(0));
    expect(result.current.position).toBe(1);
    act(() => void vi.advanceTimersByTime(MIN_GAP_MS - 1));
    expect(result.current.position).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.position).toBe(2);

    act(() => result.current.seek(3)); // pauses; the next event (4) waits 3,8 s → 2 s
    expect(result.current.playing).toBe(false);
    act(() => result.current.toggle());
    act(() => void vi.advanceTimersByTime(MAX_GAP_MS - 1));
    expect(result.current.position).toBe(3);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.position).toBe(4);

    act(() => result.current.setSpeed(4)); // 2 s / 4 = 500 ms for the 4 → 5 hop? gap is 700 ms real
    act(() => void vi.advanceTimersByTime(700 / 4));
    expect(result.current.position).toBe(5);
    expect(pulseEdges(result.current.pulses)).toEqual([["l1", [false]]]);
    act(() => void vi.advanceTimersByTime(1500)); // the pulse has crossed the arrow
    expect(result.current.pulses).toEqual([]);
  });

  it("pausa, chega ao fim e recomeça do início", () => {
    const { result } = setup();
    act(() => result.current.setSpeed(8));
    act(() => result.current.toggle());
    for (let i = 0; i < 40; i++) act(() => void vi.advanceTimersByTime(1000)); // each tick re-renders
    expect(result.current.position).toBe(11);
    expect(result.current.playing).toBe(false);
    expect(result.current.atEnd).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.position).toBe(0);
    expect(result.current.playing).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.playing).toBe(false);
  });
});
