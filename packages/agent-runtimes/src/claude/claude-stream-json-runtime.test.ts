import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../contract/agent-runtime.js";
import { readHostEnvironment } from "../platform/host-environment.js";
import {
  RecordingCommunication,
  eventually,
  isAlive,
  testDeps,
  untilState,
} from "../testing/fake-claude-support.js";
import { ClaudeLoginRequiredError } from "./claude-cli.js";
import { ClaudeStreamJsonRuntime, costOfTurn } from "./claude-stream-json-runtime.js";

const message = (body: string, overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "m-1",
  from: "Pesquisador",
  kind: "message",
  body,
  replyTo: null,
  ...overrides,
});

describe("ClaudeStreamJsonRuntime (fake CLI)", () => {
  const live: ClaudeStreamJsonRuntime[] = [];
  let communication = new RecordingCommunication();

  function create(
    options: {
      fakeFlags?: string[];
      cwd?: string;
      host?: Record<string, string>;
      usageFlushMs?: number;
    } = {},
  ) {
    const deps = testDeps(options);
    const runtime = new ClaudeStreamJsonRuntime(
      { name: "Revisor", cwd: options.cwd ?? process.cwd(), args: [], effort: "low" },
      communication,
      deps,
    );
    live.push(runtime);
    return { runtime, deps };
  }

  async function started(options: Parameters<typeof create>[0] = {}) {
    const created = create(options);
    await created.runtime.start("# Você é Revisor");
    return created;
  }

  beforeEach(() => {
    communication = new RecordingCommunication();
  });

  afterEach(async () => {
    await Promise.all(live.splice(0).map((runtime) => runtime.stop()));
  });

  it("starts idle, takes a message and goes idle again at the result event", async () => {
    const { runtime } = await started();
    expect(runtime.state).toBe("idle");

    await runtime.deliver(message("!send Pesquisador oi"));
    expect(runtime.state).toBe("busy");
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Pesquisador", text: "oi" }]);
  });

  it("reports the usage and cost of each turn before going idle", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!peers"));
    await untilState(runtime, "idle");

    expect(communication.usage).toEqual([
      {
        model: "fake-model",
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
        costUsd: 0.0123,
        durationMs: 12,
        turns: 2,
      },
    ]);
  });

  it("reports the cost of each turn, not the session total the CLI carries in every result", async () => {
    const { runtime } = await started();

    for (const text of ["!peers", "!peers", "!peers"]) {
      await runtime.deliver(message(text));
      await untilState(runtime, "idle");
    }

    // The fake CLI adds 0.0123 per turn to its running total, like the real one.
    expect(communication.usage.map((usage) => usage.costUsd)).toEqual([0.0123, 0.0123, 0.0123]);
  });

  it("reports its usage on the cost, as a runtime that knows the price", () => {
    expect(create().runtime.reportsCost).toBe(true);
  });

  describe("stop while a turn is under way", () => {
    it("waits for the result event, so the usage of the closing turn is not lost", async () => {
      const { runtime } = await started({ usageFlushMs: 10_000 });
      await runtime.deliver(message("!finish pronto\n!sleep 400"));
      await eventually(() => communication.finished.length === 1);
      expect(communication.usage).toEqual([]);

      await runtime.stop();

      expect(communication.usage).toHaveLength(1);
      expect(communication.usage[0]).toMatchObject({ costUsd: 0.0123 });
      expect(runtime.state).toBe("stopped");
    });

    it("gives up after the flush window and still kills the CLI", async () => {
      const { runtime } = await started({ usageFlushMs: 100 });
      await runtime.deliver(message("!sleep 5000"));
      await untilState(runtime, "busy");
      const pid = runtime.processId!;

      const startedAt = Date.now();
      await runtime.stop();

      expect(Date.now() - startedAt).toBeLessThan(4_000);
      expect(communication.usage).toEqual([]);
      expect(isAlive(pid)).toBe(false);
    });

    it("does not wait when the agent is idle", async () => {
      const { runtime } = await started({ usageFlushMs: 60_000 });
      const startedAt = Date.now();
      await runtime.stop();
      expect(Date.now() - startedAt).toBeLessThan(10_000);
    });
  });

  it("is waiting_reply while an ask is open and hands the answer back to the model", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!ask Pesquisador quanto é?\n!send Pesquisador resposta=$last"));

    await untilState(runtime, "waiting_reply");
    expect(communication.asked).toEqual([{ to: "Pesquisador", question: "quanto é?" }]);

    communication.answerAsk("42");
    await untilState(runtime, "idle");
    expect(communication.sent).toEqual([{ to: "Pesquisador", text: "resposta=42" }]);
  });

  it("answers a received message with the id it came with", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!reply tudo certo", { id: "ask-7", kind: "ask" }));
    await untilState(runtime, "idle");
    expect(communication.replies).toEqual([{ messageId: "ask-7", text: "tudo certo" }]);
  });

  it("lets the agent finish the run", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!finish resumo final"));
    await untilState(runtime, "idle");
    expect(communication.finished).toEqual(["resumo final"]);
  });

  it("refuses a message while it is not idle", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!sleep 300"));
    await expect(runtime.deliver(message("outra"))).rejects.toThrow(/não está ocioso/);
  });

  it("passes the CLI only the system minimum, never the host's secrets", async () => {
    const secret = randomBytes(8).toString("hex");
    const host = {
      ...readHostEnvironment(),
      NEURONS_MASTER_KEY: secret,
      ANTHROPIC_API_KEY: secret,
      DATABASE_PASSWORD: secret,
    } as Record<string, string>;
    const { runtime } = await started({ host });

    await runtime.deliver(message("!env Pesquisador"));
    await untilState(runtime, "idle");

    const { names } = JSON.parse(communication.sent[0]?.text ?? "{}") as { names: string[] };
    expect(names).not.toEqual(
      expect.arrayContaining(["NEURONS_MASTER_KEY", "ANTHROPIC_API_KEY", "DATABASE_PASSWORD"]),
    );
    expect(communication.sent[0]?.text).not.toContain(secret);
  });

  it("gives the CLI an MCP tool timeout that outlives the Hub's ask timeout", async () => {
    const { runtime } = await started(); // the test deps use a 5 s ask timeout
    await runtime.deliver(message("!env Pesquisador MCP_TOOL_TIMEOUT"));
    await untilState(runtime, "idle");

    const { values } = JSON.parse(communication.sent[0]?.text ?? "{}") as {
      values: Record<string, string>;
    };
    expect(Number(values.MCP_TOOL_TIMEOUT)).toBeGreaterThan(5_000);
  });

  it("leaves no process and no temporary file behind on stop()", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!pids Pesquisador"));
    await untilState(runtime, "idle");
    const pids = JSON.parse(communication.sent[0]?.text ?? "{}") as { cli: number; mcp: number };
    const directory = runtime.sessionDirectory ?? "";
    expect(existsSync(directory)).toBe(true);
    expect(isAlive(pids.cli) && isAlive(pids.mcp)).toBe(true);

    await runtime.stop();

    expect(runtime.state).toBe("stopped");
    await eventually(() => !isAlive(pids.cli) && !isAlive(pids.mcp));
    expect(existsSync(directory)).toBe(false);
  });

  it("fails, with a message in Portuguese, when nobody is logged in", async () => {
    const { runtime } = create({ fakeFlags: ["--logged-out"] });
    await expect(runtime.start("x")).rejects.toThrow(ClaudeLoginRequiredError);
    expect(runtime.state).toBe("failed");
    expect(runtime.failureReason).toMatch(/claude auth login/);
  });

  it("fails when the working folder does not exist", async () => {
    const { runtime } = create({ cwd: "C:/pasta/que/nao/existe" });
    await expect(runtime.start("x")).rejects.toThrow(/pasta de trabalho/);
    expect(runtime.state).toBe("failed");
  });

  it("fails when the CLI dies, and says so", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!crash")).catch(() => undefined);
    await untilState(runtime, "failed");
    expect(runtime.failureReason).toMatch(/encerrou de forma inesperada/);
  });

  it("warns and ignores the effort when the CLI has no such flag", async () => {
    const { deps } = await started({ fakeFlags: ["--no-effort"] });
    expect(deps.logger.warnings.join("\n")).toMatch(/--effort/);
  });
});

describe("costOfTurn", () => {
  // The totals are what the real Claude Code reported for a Haiku session of three turns.
  const totals = [0.00099091, 0.00155041, 0.00199978];

  it("turns the session totals into the cost of each turn", () => {
    const turns = totals.map((total, index) => costOfTurn(total, totals[index - 1] ?? 0));

    expect(turns).toEqual([0.00099091, 0.0005595, 0.00044937]);
    expect(turns.reduce((sum, turn) => sum + turn, 0)).toBeCloseTo(0.00199978, 10);
  });

  it("takes a total that went down as a counter that restarted", () => {
    expect(costOfTurn(0.002, 0.01)).toBe(0.002);
  });

  it("is zero for a turn that cost nothing", () => {
    expect(costOfTurn(0.5, 0.5)).toBe(0);
  });
});
