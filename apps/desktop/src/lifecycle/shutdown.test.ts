import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdown, type ShutdownStep } from "./shutdown.js";

describe("createShutdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function rig(steps: ShutdownStep[]) {
    const events: string[] = [];
    const logs: string[] = [];
    const shutdown = createShutdown({
      steps: steps.map((step) => ({
        ...step,
        run: async () => {
          events.push(`começa ${step.name}`);
          await step.run();
          events.push(`termina ${step.name}`);
        },
      })),
      exit: () => events.push("sai"),
      log: (line) => logs.push(line),
    });
    return { shutdown, events, logs };
  }

  const after = (ms: number) => () => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const never = () => new Promise<void>(() => undefined);

  it("closes the steps one after the other, then leaves", async () => {
    const { shutdown, events } = rig([
      { name: "contas", run: after(10), timeoutMs: 1000 },
      { name: "servidor", run: after(50), timeoutMs: 1000 },
    ]);

    const done = shutdown.run();
    await vi.advanceTimersByTimeAsync(200);
    await done;

    expect(events).toEqual([
      "começa contas",
      "termina contas",
      "começa servidor",
      "termina servidor",
      "sai",
    ]);
  });

  it("leaves even when a step never answers, naming which one held it", async () => {
    const { shutdown, events, logs } = rig([
      { name: "contas", run: never, timeoutMs: 500 },
      { name: "servidor", run: after(10), timeoutMs: 1000 },
    ]);

    const done = shutdown.run();
    await vi.advanceTimersByTimeAsync(499);
    expect(events).toEqual(["começa contas"]); // still waiting for it
    await vi.advanceTimersByTimeAsync(600);
    await done;

    expect(events).toEqual(["começa contas", "começa servidor", "termina servidor", "sai"]);
    expect(logs).toEqual([expect.stringContaining('"contas"')]);
  });

  it("says what still holds the process when a step runs out of time", async () => {
    const logs: string[] = [];
    const shutdown = createShutdown({
      steps: [{ name: "servidor", run: never, timeoutMs: 100 }],
      exit: vi.fn(),
      log: (line) => logs.push(line),
      diagnose: () => "TCPSocketWrap×2",
    });
    const done = shutdown.run();
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(logs).toEqual([expect.stringContaining("Ainda aberto: TCPSocketWrap×2.")]);
  });

  it("leaves when the server step itself hangs, after its own time limit", async () => {
    const { shutdown, events, logs } = rig([
      { name: "contas", run: after(1), timeoutMs: 1000 },
      { name: "servidor", run: never, timeoutMs: 20_000 },
    ]);

    const done = shutdown.run();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(events.at(-1)).toBe("começa servidor");
    await vi.advanceTimersByTimeAsync(2);
    await done;

    expect(events.at(-1)).toBe("sai");
    expect(logs).toEqual([expect.stringContaining('"servidor"')]);
  });

  it("carries on after a step that fails, without leaking the error's details", async () => {
    const { shutdown, events, logs } = rig([
      {
        name: "contas",
        run: () => Promise.reject(new TypeError("token-secreto-123")),
        timeoutMs: 1000,
      },
      { name: "servidor", run: after(1), timeoutMs: 1000 },
    ]);

    const done = shutdown.run();
    await vi.advanceTimersByTimeAsync(10);
    await done;

    expect(events).toEqual(["começa contas", "começa servidor", "termina servidor", "sai"]);
    expect(logs).toEqual(['Encerramento: "contas" falhou (TypeError).']);
    expect(logs.join()).not.toContain("token-secreto");
  });

  it("survives a step that throws before returning a promise", async () => {
    const shutdown = createShutdown({
      steps: [
        {
          name: "sincrono",
          run: () => {
            throw new Error("boom");
          },
          timeoutMs: 100,
        },
      ],
      exit: vi.fn(),
      log: vi.fn(),
    });
    await shutdown.run();
  });

  it("leaves exactly once, however many times it is asked", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown({
      steps: [{ name: "servidor", run: after(20), timeoutMs: 1000 }],
      exit,
      log: vi.fn(),
    });

    const first = shutdown.run();
    const second = shutdown.run();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([first, second]);
    await shutdown.run();

    expect(second).toBe(first);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("leaves a timer behind on no step: a step that ended in time cancels its limit", async () => {
    const { shutdown } = rig([{ name: "servidor", run: after(5), timeoutMs: 60_000 }]);
    const done = shutdown.run();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(vi.getTimerCount()).toBe(0);
  });
});
