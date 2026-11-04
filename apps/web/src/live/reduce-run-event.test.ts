import { describe, expect, it } from "vitest";
import fixture from "./fixtures/two-terminals-demo.json";
import { initialRunLiveState, reduceRunEvent } from "./reduce-run-event";
import type { RunLiveState, RunLogEvent } from "./types";

const events = fixture.events as RunLogEvent[];
const fold = (list: RunLogEvent[], from: RunLiveState = initialRunLiveState) =>
  list.reduce<RunLiveState>(reduceRunEvent, from);
const event = (seq: number, type: string, agent: string | null, payload: unknown): RunLogEvent => ({
  seq,
  type,
  agent,
  payload,
  at: "2026-11-04T12:00:00.000Z",
});

describe("reduceRunEvent com a execução da demo", () => {
  it("acompanha o status do agente em cada passo", () => {
    const at = (n: number) => fold(events.slice(0, n));
    expect(at(1).status).toBe("running");
    expect(at(3).agents["Pesquisador"]?.status).toBe("starting");
    expect(at(4).agents["Pesquisador"]?.status).toBe("busy");
    expect(at(5).agents["Pesquisador"]?.status).toBe("waiting_reply");
    expect(at(5).agents["Revisor"]?.status).toBe("starting");
    expect(at(7).agents["Revisor"]?.status).toBe("busy");
    expect(at(9).agents["Pesquisador"]?.status).toBe("busy");
    expect(at(10).agents["Revisor"]?.status).toBe("idle");
  });

  it("termina a execução e marca os agentes como finalizados", () => {
    const final = fold(events);
    expect(final.status).toBe("succeeded");
    expect(final.finish).toMatchObject({
      seq: 11,
      reason: "finished",
      agent: "Pesquisador",
      result: "resumo validado: certo",
    });
    expect(Object.values(final.agents).map((a) => a.status)).toEqual(["finished", "finished"]);
    expect(final.lastSeq).toBe(11);
  });

  it("monta a linha do tempo e os pulsos, sem tratar @trigger como agente", () => {
    const final = fold(events);
    expect(final.timeline.map((m) => [m.from, m.to, m.kind, m.delivered])).toEqual([
      ["@trigger", "Pesquisador", "message", true],
      ["Pesquisador", "Revisor", "ask", true],
      ["Revisor", "Pesquisador", "reply", true],
    ]);
    expect(final.timeline[2]?.replyTo).toBe("m-0002");
    expect(final.pulses).toEqual([
      { from: "@trigger", to: "Pesquisador", kind: "message", seq: 2 },
      { from: "Pesquisador", to: "Revisor", kind: "ask", seq: 5 },
      { from: "Revisor", to: "Pesquisador", kind: "reply", seq: 8 },
    ]);
    expect(Object.keys(final.agents)).toEqual(["Pesquisador", "Revisor"]);
  });

  it("soma o custo conhecido; quem não informou custo fica null", () => {
    const final = fold(events);
    expect(final.agents["Revisor"]?.costUsd).toBe(0.0123);
    expect(final.agents["Pesquisador"]?.costUsd).toBeNull();
    expect(final.totals).toEqual({ costUsd: 0.0123, turns: 1, unknownCostTurns: 0 });
  });

  it("aplicar o mesmo log duas vezes não muda nada (duplicatas e replay)", () => {
    const once = fold(events);
    expect(fold(events, once)).toBe(once);
    expect(reduceRunEvent(once, events[3]!)).toBe(once);
  });
});

describe("reduceRunEvent: casos de borda", () => {
  it("custo desconhecido nunca vira 0 e conta como turno sem custo", () => {
    const unknown = fold([
      event(1, "UsageRecorded", "A", { costUsd: null }),
      event(2, "UsageRecorded", "A", {}),
    ]);
    expect(unknown.agents["A"]).toMatchObject({ costUsd: null, turns: 2, unknownCostTurns: 2 });
    expect(unknown.totals.unknownCostTurns).toBe(2);

    const mixed = fold([
      event(1, "UsageRecorded", "A", { costUsd: 0.5 }),
      event(2, "UsageRecorded", "A", { costUsd: null }),
    ]);
    expect(mixed.agents["A"]).toMatchObject({ costUsd: 0.5, unknownCostTurns: 1 });
  });

  it("falha do agente e eventos de guarda", () => {
    const state = fold([
      event(1, "GuardWarning", "A", {
        guard: "run_budget",
        code: "cost_unknown",
        message: "sem custo",
      }),
      event(2, "GuardTripped", "A", { guard: "agent_budget", scope: "agent", reason: "estourou" }),
      event(3, "AgentFailed", "A", { reason: "orçamento" }),
      event(4, "UsageRecorded", "A", { costUsd: 0.1 }),
    ]);
    expect(state.guardEvents.map((g) => [g.type, g.guard, g.message])).toEqual([
      ["GuardWarning", "run_budget", "sem custo"],
      ["GuardTripped", "agent_budget", "estourou"],
    ]);
    expect(state.agents["A"]).toMatchObject({ status: "failed", failure: "orçamento" });
  });

  it("mapeia o motivo do fim para o status da execução", () => {
    const status = (reason: string) => fold([event(1, "RunFinished", null, { reason })]).status;
    expect(status("quiescent")).toBe("succeeded");
    expect(status("stopped")).toBe("cancelled");
    expect(status("guard_tripped")).toBe("failed");
    expect(status("failed")).toBe("failed");
  });

  it("guarda só os últimos 20 pulsos e corta a prévia do texto", () => {
    const sent = Array.from({ length: 25 }, (_, i) =>
      event(i + 1, "MessageSent", "A", {
        messageId: `m${i}`,
        from: "A",
        to: "B",
        kind: "message",
        body: "x".repeat(500),
      }),
    );
    const state = fold(sent);
    expect(state.pulses).toHaveLength(20);
    expect(state.pulses[0]?.seq).toBe(6);
    expect(state.timeline[0]?.preview).toHaveLength(200);
  });

  it("ignora tipos desconhecidos mas avança o seq", () => {
    const state = fold([event(1, "Algo", null, { x: 1 })]);
    expect(state.lastSeq).toBe(1);
    expect(state.timeline).toEqual([]);
  });

  it("guarda a saída do terminal; o snapshot (replay) substitui o que havia", () => {
    let state = reduceRunEvent(initialRunLiveState, {
      type: "TerminalOutput",
      agent: "A",
      data: "oi ",
      replay: false,
    });
    state = reduceRunEvent(state, {
      type: "TerminalOutput",
      agent: "A",
      data: "mundo",
      replay: false,
    });
    expect(state.terminals["A"]).toBe("oi mundo");
    state = reduceRunEvent(state, {
      type: "TerminalOutput",
      agent: "A",
      data: "tudo",
      replay: true,
    });
    expect(state.terminals["A"]).toBe("tudo");
    expect(state.lastSeq).toBe(0);
  });
});
