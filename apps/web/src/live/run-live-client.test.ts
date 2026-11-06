import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "./fake-socket";
import { defaultSocketUrl, RunLiveClient } from "./run-live-client";
import type { ConnectionState, RunLiveEvent } from "./types";

const runId = "01a1a65b-a91c-7000-b8c9-8733874b49b0";
const runEvent = (seq: number, type = "MessageSent") => ({
  runId,
  seq,
  type,
  agent: null,
  payload: {},
  at: "2026-11-04T12:00:00.000Z",
});

function setup() {
  const events: RunLiveEvent[] = [];
  const states: ConnectionState[] = [];
  const errors: (string | null)[] = [];
  const client = new RunLiveClient({
    runId,
    url: "ws://localhost/ws",
    onEvent: (e) => events.push(e),
    onConnection: (s) => states.push(s),
    onError: (m) => errors.push(m),
    createSocket: (url) => new FakeSocket(url),
    baseDelayMs: 100,
    maxDelayMs: 1000,
  });
  client.start();
  return { client, events, states, errors };
}

const seqs = (events: RunLiveEvent[]) => events.map((e) => ("seq" in e ? e.seq : null));

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});
afterEach(() => vi.useRealTimers());

describe("RunLiveClient", () => {
  it("assina desde o começo (fromSeq 1) e fica ao vivo ao ser confirmado", () => {
    const { states } = setup();
    expect(states).toEqual(["connecting"]);
    FakeSocket.last.open();
    expect(FakeSocket.last.sent).toEqual([{ event: "subscribe", data: { runId, fromSeq: 1 } }]);
    FakeSocket.last.push("subscribed", { runId });
    expect(states.at(-1)).toBe("live");
  });

  it("entrega os eventos em ordem e descarta duplicatas e atrasados", () => {
    const { events } = setup();
    FakeSocket.last.open();
    for (const seq of [1, 2, 2, 3, 1, 4]) FakeSocket.last.push("run.event", runEvent(seq));
    expect(seqs(events)).toEqual([1, 2, 3, 4]);
  });

  it("ignora eventos de outra execução e quadros inválidos", () => {
    const { events } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("run.event", { ...runEvent(1), runId: "outra" });
    FakeSocket.last.onmessage?.({ data: "não é json" });
    FakeSocket.last.onmessage?.({ data: new ArrayBuffer(1) });
    expect(events).toEqual([]);
  });

  it("reconecta com backoff exponencial e reenvia o subscribe com fromSeq = último + 1", () => {
    const { states, events } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("run.event", runEvent(1));
    FakeSocket.last.push("run.event", runEvent(2));

    FakeSocket.last.drop();
    expect(states.at(-1)).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // the second attempt fails too: the delay doubles
    FakeSocket.last.drop();
    vi.advanceTimersByTime(199);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.last.open();
    expect(FakeSocket.last.sent).toEqual([{ event: "subscribe", data: { runId, fromSeq: 3 } }]);
    // the server resends from 3; a replayed 2 (e.g. an overlap) is dropped
    FakeSocket.last.push("run.event", runEvent(2));
    FakeSocket.last.push("run.event", runEvent(3));
    FakeSocket.last.push("subscribed", { runId });
    expect(seqs(events)).toEqual([1, 2, 3]);
    expect(states.at(-1)).toBe("live");

    // being confirmed resets the backoff
    FakeSocket.last.drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("limita o backoff ao máximo", () => {
    setup();
    for (let i = 0; i < 8; i++) {
      FakeSocket.last.drop();
      vi.advanceTimersByTime(1000);
    }
    expect(FakeSocket.instances).toHaveLength(9);
    FakeSocket.last.drop();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(9);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(10);
  });

  it("um buraco no seq descarta o evento e reassina do primeiro que faltou", () => {
    const { events } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("run.event", runEvent(1));
    FakeSocket.last.push("run.event", runEvent(3));
    expect(seqs(events)).toEqual([1]);
    expect(FakeSocket.last.closed).toBe(true);
    vi.advanceTimersByTime(0);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.last.open();
    expect(FakeSocket.last.sent[0]).toEqual({ event: "subscribe", data: { runId, fromSeq: 2 } });
  });

  it("repassa a saída do terminal e os erros do servidor", () => {
    const { events, errors } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("run.ephemeral", {
      runId,
      type: "TerminalOutput",
      agent: "A",
      data: "x",
      replay: true,
    });
    FakeSocket.last.push("error", { code: "invalid_message", message: "ruim" });
    expect(events).toEqual([{ type: "TerminalOutput", agent: "A", data: "x", replay: true }]);
    expect(errors).toEqual(["ruim"]);
  });

  it("para ao ver o fim da execução e não reconecta", () => {
    const { states } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("run.event", runEvent(1, "RunFinished"));
    expect(states.at(-1)).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("close() cancela a reconexão pendente", () => {
    const { client, states } = setup();
    FakeSocket.last.drop();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(states.at(-1)).toBe("closed");
  });
});

describe("defaultSocketUrl", () => {
  it("usa a mesma origem, com ws ou wss conforme a página", () => {
    expect(defaultSocketUrl({ protocol: "http:", host: "127.0.0.1:5173" })).toBe(
      "ws://127.0.0.1:5173/ws",
    );
    expect(defaultSocketUrl({ protocol: "https:", host: "app.exemplo.com" })).toBe(
      "wss://app.exemplo.com/ws",
    );
  });
});

describe("RunLiveClient: digitar no terminal", () => {
  it("manda terminal.input só depois da assinatura confirmada, sem alterar o texto", () => {
    const { client } = setup();
    FakeSocket.last.open();
    expect(client.sendTerminalInput("Pesquisador", "ls\r")).toBe(false);
    FakeSocket.last.push("subscribed", { runId });
    expect(client.sendTerminalInput("Pesquisador", "ls\r")).toBe(true);
    expect(FakeSocket.last.sent.at(-1)).toEqual({
      event: "terminal.input",
      data: { runId, agent: "Pesquisador", data: "ls\r" },
    });
    expect(client.sendTerminalInput("Pesquisador", "")).toBe(false);
  });

  it("parte uma colagem grande em mensagens que cabem no limite do servidor", () => {
    const { client } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("subscribed", { runId });
    const paste = "x".repeat(9000);
    client.sendTerminalInput("A", paste);
    const inputs = FakeSocket.last.sent.filter((m) => m.event === "terminal.input");
    expect(inputs.map((m) => (m.data["data"] as string).length)).toEqual([4000, 4000, 1000]);
    expect(inputs.map((m) => m.data["data"]).join("")).toBe(paste);
  });

  it("não manda nada com a conexão fechada", () => {
    const { client } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("subscribed", { runId });
    client.close();
    expect(client.sendTerminalInput("A", "x")).toBe(false);
  });

  it("repassa o código do erro do servidor", () => {
    const codes: (string | undefined)[] = [];
    const client = new RunLiveClient({
      runId,
      url: "ws://localhost/ws",
      onEvent: () => undefined,
      onConnection: () => undefined,
      onError: (_message, code) => codes.push(code),
      createSocket: (url) => new FakeSocket(url),
    });
    client.start();
    FakeSocket.last.open();
    FakeSocket.last.push("error", { code: "rate_limited", message: "devagar" });
    expect(codes).toEqual(["rate_limited"]);
  });
  it("renova a sessão e reabre o socket quando o servidor recusa por sessão inválida", async () => {
    const renewSession = vi.fn(() => Promise.resolve());
    const client = new RunLiveClient({
      runId,
      url: "ws://localhost/ws",
      onEvent: () => undefined,
      onConnection: () => undefined,
      renewSession,
      createSocket: (url) => new FakeSocket(url),
      baseDelayMs: 100,
    });
    client.start();
    const first = FakeSocket.last;
    first.open();
    first.push("error", { code: "invalid_session", message: "Sessão inválida ou expirada." });
    expect(renewSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.last).not.toBe(first);
    FakeSocket.last.open();
    expect(FakeSocket.last.sent).toEqual([{ event: "subscribe", data: { runId, fromSeq: 1 } }]);
    FakeSocket.last.push("error", { code: "invalid_session", message: "x" });
    FakeSocket.last.push("error", { code: "invalid_session", message: "x" });
    await vi.advanceTimersByTimeAsync(0);
    expect(renewSession.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("RunLiveClient: tamanho do terminal", () => {
  it("manda terminal.resize só depois da assinatura confirmada", () => {
    const { client } = setup();
    FakeSocket.last.open();
    expect(client.sendTerminalResize("Pesquisador", 100, 30)).toBe(false);
    expect(FakeSocket.last.sent).toEqual([{ event: "subscribe", data: { runId, fromSeq: 1 } }]);

    FakeSocket.last.push("subscribed", { runId });
    // The size asked for before the confirmation goes out with it.
    expect(FakeSocket.last.sent.at(-1)).toEqual({
      event: "terminal.resize",
      data: { runId, agent: "Pesquisador", cols: 100, rows: 30 },
    });
    expect(client.sendTerminalResize("Pesquisador", 110, 35)).toBe(true);
    expect(FakeSocket.last.sent.at(-1)).toEqual({
      event: "terminal.resize",
      data: { runId, agent: "Pesquisador", cols: 110, rows: 35 },
    });
  });

  it("lembra o último tamanho de cada agente e o manda de novo ao reassinar", () => {
    const { client } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("subscribed", { runId });
    client.sendTerminalResize("A", 100, 30);
    client.sendTerminalResize("A", 120, 40);
    client.sendTerminalResize("B", 80, 24);

    FakeSocket.last.drop();
    vi.advanceTimersByTime(100);
    FakeSocket.last.open();
    FakeSocket.last.push("subscribed", { runId });

    const resizes = FakeSocket.last.sent.filter((message) => message.event === "terminal.resize");
    expect(resizes.map((message) => message.data)).toEqual([
      { runId, agent: "A", cols: 120, rows: 40 },
      { runId, agent: "B", cols: 80, rows: 24 },
    ]);
  });

  it("repassa o tamanho que o servidor deu ao terminal, e o tamanho do resumo", () => {
    const { events } = setup();
    FakeSocket.last.open();
    FakeSocket.last.push("run.ephemeral", {
      runId,
      type: "TerminalResized",
      agent: "A",
      cols: 90,
      rows: 30,
    });
    FakeSocket.last.push("run.ephemeral", {
      runId,
      type: "TerminalOutput",
      agent: "A",
      data: "x",
      replay: true,
      cols: 90,
      rows: 30,
    });

    expect(events).toEqual([
      { type: "TerminalResized", agent: "A", cols: 90, rows: 30 },
      { type: "TerminalOutput", agent: "A", data: "x", replay: true, cols: 90, rows: 30 },
    ]);
  });

  it("ignora tamanhos que não são números inteiros positivos", () => {
    const { events } = setup();
    FakeSocket.last.open();
    for (const [cols, rows] of [
      [0, 30],
      [90.5, 30],
      ["90", 30],
      [90, null],
    ]) {
      FakeSocket.last.push("run.ephemeral", {
        runId,
        type: "TerminalResized",
        agent: "A",
        cols,
        rows,
      });
    }
    FakeSocket.last.push("run.ephemeral", {
      runId,
      type: "TerminalOutput",
      agent: "A",
      data: "x",
      replay: true,
      cols: -1,
      rows: 30,
    });

    expect(events).toEqual([{ type: "TerminalOutput", agent: "A", data: "x", replay: true }]);
  });
});
