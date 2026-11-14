import { describe, expect, it } from "vitest";
import fixture from "./fixtures/two-terminals-demo.json";
import { selectActivity } from "./activity";
import {
  initialRunLiveState,
  MAX_ACTIVITY,
  reduceRunEvent,
  TERMINAL_MAX_CHARS,
  TERMINAL_TRIM_SLACK,
} from "./reduce-run-event";
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

describe("reduceRunEvent com AgentStateChanged (T14b)", () => {
  const state = (agent: string, value: string, reason?: string) => ({
    state: value,
    ...(reason && { reason }),
    agent,
  });

  it("o estado vem do evento e a dedução antiga deixa de valer para aquele agente", () => {
    const result = fold([
      event(1, "AgentStarted", "A", {}),
      event(2, "AgentStateChanged", "A", state("A", "starting")),
      event(3, "AgentStateChanged", "A", state("A", "busy")),
      // A turn ended, but the server did not say idle: the deduction must not guess it.
      event(4, "UsageRecorded", "A", { costUsd: 0.1 }),
    ]);
    expect(result.agents["A"]).toMatchObject({ status: "busy", stateSource: "event", turns: 1 });

    const waiting = fold([
      event(1, "AgentStateChanged", "A", state("A", "waiting_reply")),
      // An `ask` already deduced waiting_reply; a delivery would deduce busy. Neither overrides the server.
      event(2, "MessageDelivered", "A", { messageId: "m", to: "A" }),
    ]);
    expect(waiting.agents["A"]?.status).toBe("waiting_reply");
  });

  it("cada estado do servidor é aplicado, e um agente que falhou continua falhado", () => {
    const at = (value: string) =>
      fold([event(1, "AgentStateChanged", "A", state("A", value))]).agents["A"]?.status;
    expect(["starting", "busy", "idle", "waiting_reply", "finished"].map(at)).toEqual([
      "starting",
      "busy",
      "idle",
      "waiting_reply",
      "finished",
    ]);
    const failed = fold([
      event(1, "AgentStateChanged", "A", state("A", "failed", "o CLI caiu")),
      event(2, "AgentStateChanged", "A", state("A", "finished")),
    ]);
    expect(failed.agents["A"]).toMatchObject({ status: "failed", failure: "o CLI caiu" });
  });

  it("ignora um estado que não conhece, mas avança o seq", () => {
    const result = fold([event(1, "AgentStateChanged", "A", state("A", "dormindo"))]);
    expect(result.agents["A"]).toBeUndefined();
    expect(result.lastSeq).toBe(1);
  });

  it("é idempotente por seq", () => {
    const log = [
      event(1, "AgentStateChanged", "A", state("A", "busy")),
      event(2, "AgentStateChanged", "A", state("A", "idle")),
    ];
    const once = fold(log);
    expect(fold(log, once)).toBe(once);
    expect(reduceRunEvent(once, log[0]!)).toBe(once);
  });

  it("a fixture antiga (sem o evento) continua deduzindo o estado", () => {
    expect(events.some((e) => e.type === "AgentStateChanged")).toBe(false);
    expect(fold(events.slice(0, 5)).agents["Pesquisador"]).toMatchObject({
      status: "waiting_reply",
      stateSource: "deduced",
    });
  });
});

describe("linha do tempo única e terminal", () => {
  it("junta mensagens e ferramentas em ordem de seq, sem guardar nada duas vezes", () => {
    const result = fold([
      event(1, "MessageSent", "@trigger", {
        messageId: "m1",
        from: "@trigger",
        to: "A",
        kind: "message",
        body: "oi",
      }),
      event(2, "ToolCalled", "A", {
        tool: "obsidian_read",
        inputSummary: '{"path":"x.md"}',
        durationMs: 4,
        ok: true,
        errorCode: null,
      }),
      event(3, "MessageSent", "A", {
        messageId: "m2",
        from: "A",
        to: "B",
        kind: "message",
        body: "olá",
      }),
    ]);
    expect(selectActivity(result).map((i) => [i.type, i.seq])).toEqual([
      ["message", 1],
      ["tool", 2],
      ["message", 3],
    ]);
    expect(selectActivity(result, "B").map((i) => i.seq)).toEqual([3]);
    expect(selectActivity(result, "A").map((i) => i.seq)).toEqual([1, 2, 3]);
    // The same ToolCalled twice (a duplicate from a reconnection) is still one row.
    expect(result.toolCalls).toHaveLength(1);
  });

  it("conta o que o terminal recebeu e quantos snapshots já trocaram a tela", () => {
    const chunk = (data: string, replay = false) =>
      ({ type: "TerminalOutput", agent: "A", data, replay }) as const;
    let result = reduceRunEvent(initialRunLiveState, chunk("abc"));
    result = reduceRunEvent(result, chunk("de"));
    expect(result.terminalMeta["A"]).toEqual({ resets: 0, total: 5 });
    result = reduceRunEvent(result, chunk("tela", true));
    expect(result.terminals["A"]).toBe("tela");
    expect(result.terminalMeta["A"]).toEqual({ resets: 1, total: 4 });
  });

  it("guarda o tamanho do terminal que o servidor informa, sem mexer na tela nem nas contas", () => {
    const chunk = (data: string, replay = false, size = {}) =>
      ({ type: "TerminalOutput", agent: "A", data, replay, ...size }) as const;
    let result = reduceRunEvent(initialRunLiveState, chunk("abc"));

    result = reduceRunEvent(result, { type: "TerminalResized", agent: "A", cols: 90, rows: 30 });

    expect(result.terminals["A"]).toBe("abc");
    expect(result.terminalMeta["A"]).toEqual({ resets: 0, total: 3, cols: 90, rows: 30 });
    // The characters that follow are still counted, and the size stays.
    result = reduceRunEvent(result, chunk("de"));
    expect(result.terminalMeta["A"]).toEqual({ resets: 0, total: 5, cols: 90, rows: 30 });
  });

  it("um resumo traz o tamanho em que foi impresso; sem tamanho, vale o que já se sabia", () => {
    const chunk = (data: string, size = {}) =>
      ({ type: "TerminalOutput", agent: "A", data, replay: true, ...size }) as const;
    let result = reduceRunEvent(initialRunLiveState, chunk("um", { cols: 100, rows: 30 }));
    expect(result.terminalMeta["A"]).toEqual({ resets: 1, total: 2, cols: 100, rows: 30 });

    result = reduceRunEvent(result, chunk("dois", { cols: 80, rows: 24 }));
    expect(result.terminalMeta["A"]).toEqual({ resets: 2, total: 4, cols: 80, rows: 24 });

    result = reduceRunEvent(result, chunk("três")); // an older server
    expect(result.terminalMeta["A"]).toEqual({ resets: 3, total: 4, cols: 80, rows: 24 });
  });

  it("aceita o tamanho de um terminal que ainda não imprimiu nada", () => {
    const result = reduceRunEvent(initialRunLiveState, {
      type: "TerminalResized",
      agent: "A",
      cols: 90,
      rows: 30,
    });
    expect(result.terminalMeta["A"]).toEqual({ resets: 0, total: 0, cols: 90, rows: 30 });
    expect(result.terminals["A"]).toBeUndefined();
  });

  it("guarda só as últimas entradas de mensagens, ferramentas e guardas, e conta as descartadas", () => {
    const total = MAX_ACTIVITY + 7;
    const list: RunLogEvent[] = [];
    for (let i = 1; i <= total; i++) {
      list.push(
        event(3 * i - 2, "MessageSent", "A", {
          from: "A",
          to: "B",
          kind: "message",
          body: `m${i}`,
        }),
      );
      list.push(event(3 * i - 1, "ToolCalled", "A", { tool: "Read", ok: true }));
      list.push(event(3 * i, "GuardWarning", "A", { guard: "g", message: `w${i}` }));
    }
    const state = fold(list);
    expect(state.timeline).toHaveLength(MAX_ACTIVITY);
    expect(state.toolCalls).toHaveLength(MAX_ACTIVITY);
    expect(state.guardEvents).toHaveLength(MAX_ACTIVITY);
    expect(state.trimmed).toEqual({ timeline: 7, toolCalls: 7, guardEvents: 7 });
    expect(state.timeline[0]?.preview).toBe("m8");
    expect(state.timeline.at(-1)?.preview).toBe(`m${total}`);
  });

  it("só corta a saída do terminal quando passa do limite com folga, e corta até o limite", () => {
    const chunk = (data: string) =>
      ({ type: "TerminalOutput", agent: "A", data, replay: false }) as const;
    let state = reduceRunEvent(initialRunLiveState, chunk("x".repeat(TERMINAL_MAX_CHARS)));
    state = reduceRunEvent(state, chunk("y".repeat(10)));
    // Over the limit but inside the slack: nothing is cut yet.
    expect(state.terminals["A"]).toHaveLength(TERMINAL_MAX_CHARS + 10);
    state = reduceRunEvent(state, chunk("z".repeat(TERMINAL_TRIM_SLACK)));
    expect(state.terminals["A"]).toHaveLength(TERMINAL_MAX_CHARS);
    expect(state.terminals["A"]?.endsWith("z")).toBe(true);
    expect(state.terminalMeta["A"]?.total).toBe(TERMINAL_MAX_CHARS + 10 + TERMINAL_TRIM_SLACK);
  });
});
