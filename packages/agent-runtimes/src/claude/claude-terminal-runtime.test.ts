import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../contract/agent-runtime.js";
import {
  RecordingCommunication,
  eventually,
  isAlive,
  testDeps,
  untilState,
} from "../testing/fake-claude-support.js";
import { ClaudeLoginRequiredError } from "./claude-cli.js";
import { ClaudeTerminalRuntime, type TerminalTimings } from "./claude-terminal-runtime.js";

/** Short waits: the fake CLI repaints at once. */
const FAST: Partial<TerminalTimings> = {
  bootTimeoutMs: 90_000,
  readyQuietMs: 150,
  enterDelayMs: 100,
  submitConfirmMs: 8_000,
  footerConfirmMs: 500,
  hookGraceMs: 600,
  silenceMs: 300,
  pollMs: 20,
};

const message = (body: string, overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "m-1",
  from: "Revisor",
  kind: "message",
  body,
  replyTo: null,
  ...overrides,
});

describe("ClaudeTerminalRuntime (fake CLI in a PTY)", () => {
  const live: ClaudeTerminalRuntime[] = [];
  let communication = new RecordingCommunication();

  function create(options: { fakeFlags?: string[]; timings?: Partial<TerminalTimings> } = {}) {
    const deps = testDeps({ fakeFlags: options.fakeFlags ?? [] });
    const runtime = new ClaudeTerminalRuntime(
      { name: "Pesquisador", cwd: process.cwd(), args: [], effort: "low" },
      communication,
      deps,
      { timings: { ...FAST, ...options.timings } },
    );
    live.push(runtime);
    return { runtime, deps };
  }

  async function started(options: Parameters<typeof create>[0] = {}) {
    const created = create(options);
    await created.runtime.start("# Você é Pesquisador");
    return created;
  }

  beforeEach(() => {
    communication = new RecordingCommunication();
  });

  afterEach(async () => {
    await Promise.all(live.splice(0).map((runtime) => runtime.stop()));
  });

  it("does not report cost: the screen carries no structured usage", () => {
    expect(create().runtime.reportsCost).toBe(false);
  });

  it("starts idle once the footer shows the input box is free", async () => {
    const { runtime } = await started();
    expect(runtime.state).toBe("idle");
    expect(runtime.outputSnapshot()).toContain("? for shortcuts");
  });

  it("injects a message (typed, echoed, confirmed) and goes idle at the Stop hook", async () => {
    const { runtime } = await started();

    await runtime.deliver(message("!send Revisor ola"));
    expect(runtime.state).toBe("busy");
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "ola" }]);
  });

  it("injects a multi-line message through bracketed paste, header included", async () => {
    const { runtime } = await started();

    await runtime.deliver(
      message("primeira linha\n!send Revisor ok\n!finish feito", { id: "m-42" }),
    );
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "ok" }]);
    expect(communication.finished).toEqual(["feito"]);
  });

  it("presses Enter again when the first one is not confirmed by the UserPromptSubmit hook", async () => {
    const { runtime } = await started({ fakeFlags: ["--ignore-first-enter"] });

    await runtime.deliver(message("!send Revisor depois-do-segundo-enter"));
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "depois-do-segundo-enter" }]);
  });

  it("is waiting_reply while an ask blocks, then resumes the turn with the answer", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!ask Revisor tudo certo?\n!send Revisor resposta=$last"));

    await untilState(runtime, "waiting_reply");
    expect(communication.asked).toEqual([{ to: "Revisor", question: "tudo certo?" }]);

    communication.answerAsk("sim");
    await untilState(runtime, "idle");
    expect(communication.sent).toEqual([{ to: "Revisor", text: "resposta=sim" }]);
  });

  it("lets the agent answer a message by its id and finish the run", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!reply certo\n!finish encerrado", { id: "ask-9", kind: "ask" }));
    await untilState(runtime, "idle");

    expect(communication.replies).toEqual([{ messageId: "ask-9", text: "certo" }]);
    expect(communication.finished).toEqual(["encerrado"]);
  });

  it("falls back to the free footer and silence when the Stop hook never arrives", async () => {
    const { runtime } = await started({ fakeFlags: ["--never-stop"] });
    await runtime.deliver(message("!send Revisor oi"));
    await untilState(runtime, "idle");
    expect(communication.sent).toHaveLength(1);
  });

  it("answers the first-run theme dialog by itself", async () => {
    const { runtime } = await started({ fakeFlags: ["--theme-dialog"] });
    expect(runtime.state).toBe("idle");
  });

  it("never trusts a folder for the user: the boot fails with instructions", async () => {
    const { runtime } = create({
      fakeFlags: ["--trust-dialog"],
      timings: { userDialogTimeoutMs: 500 },
    });
    await expect(runtime.start("x")).rejects.toThrow(/confiar na pasta/);
    expect(runtime.state).toBe("failed");
  });

  it("stops at once while the CLI waits at a dialog nobody answers, without calling it a failure", async () => {
    // The default waits: the boot would give up only after a minute.
    const { runtime } = create({
      fakeFlags: ["--trust-dialog"],
      timings: { userDialogTimeoutMs: 60_000 },
    });
    const booting = runtime.start("x");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const pid = runtime.processId;
    expect(pid).toBeDefined();

    const startedAt = Date.now();
    await runtime.stop();
    await booting;

    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(runtime.state).toBe("stopped");
    expect(runtime.failureReason).toBeUndefined();
    expect(isAlive(pid ?? 0)).toBe(false);
  });

  it("does not boot at all when it was stopped before `start` was called", async () => {
    const { runtime } = create();
    await runtime.stop();

    await runtime.start("x");

    expect(runtime.state).toBe("stopped");
    expect(runtime.processId).toBeUndefined();
  });

  it('trusts the folder only when told to, moving off the highlighted "No, exit" first', async () => {
    const deps = testDeps({ fakeFlags: ["--trust-dialog"] });
    const runtime = new ClaudeTerminalRuntime(
      { name: "Pesquisador", cwd: process.cwd(), args: [], effort: "low" },
      communication,
      deps,
      { trustWorkingDirectory: true, timings: FAST },
    );
    live.push(runtime);

    await runtime.start("x");

    expect(runtime.state).toBe("idle");
  });

  it("fails with a login instruction when nobody is logged in, without starting the CLI", async () => {
    const { runtime } = create({ fakeFlags: ["--logged-out"] });
    await expect(runtime.start("x")).rejects.toThrow(ClaudeLoginRequiredError);
    expect(runtime.failureReason).toMatch(/claude auth login/);
    expect(runtime.processId).toBeUndefined();
  });

  it("treats a prompt the user types in the terminal as a turn of its own", async () => {
    const { runtime } = await started();
    runtime.writeInput("oi");
    await new Promise((resolve) => setTimeout(resolve, 300));
    runtime.writeInput("\r");

    await untilState(runtime, "busy");
    await untilState(runtime, "idle");
  });

  it("streams the raw output live and keeps a snapshot for who connects late", async () => {
    const { runtime } = create();
    const chunks: string[] = [];
    runtime.onOutput((chunk) => chunks.push(chunk));
    await runtime.start("x");

    expect(chunks.join("")).toContain("? for shortcuts");
    expect(runtime.outputSnapshot()).toBe(chunks.join(""));
  });

  describe("resize", () => {
    it("opens at 120x40 and the CLI sees that size", async () => {
      const { runtime } = await started({ fakeFlags: ["--show-size"] });
      expect(runtime.size).toEqual({ cols: 120, rows: 40 });
      expect(runtime.outputSnapshot()).toContain("[size 120x40]");
    });

    it("resizes the PTY (the CLI repaints at the new size) and starts the replay at the resize", async () => {
      const { runtime } = await started({ fakeFlags: ["--show-size"] });
      const resized: unknown[] = [];
      runtime.onResize((size) => resized.push(size));
      const before = runtime.outputSnapshot();
      expect(before).toContain("[size 120x40]");

      runtime.resize(90, 30);

      // At once, before anything laid out for the new size arrives, the old bytes are gone.
      expect(runtime.outputSnapshot()).toBe("");
      expect(runtime.size).toEqual({ cols: 90, rows: 30 });
      expect(resized).toEqual([{ cols: 90, rows: 30 }]);
      await eventually(() => runtime.outputSnapshot().includes("[size 90x30]"));
      // (The Windows pseudo-console repaints its own screen after a resize, so what comes next may
      // still mention the old size; what matters is that the replay was restarted.)
      expect(runtime.outputSnapshot().startsWith(before)).toBe(false);
    });

    it("keeps the screen the runtime reads in step with the PTY", async () => {
      const { runtime } = await started({ fakeFlags: ["--show-size"] });
      runtime.resize(100, 24);
      await eventually(() => runtime.outputSnapshot().includes("[size 100x24]"));
      await runtime.deliver(message("!send Revisor depois-do-resize"));
      await untilState(runtime, "idle");
      expect(communication.sent).toEqual([{ to: "Revisor", text: "depois-do-resize" }]);
    });

    it("ignores the same size and sizes that make no sense", async () => {
      const { runtime } = await started();
      const resized: unknown[] = [];
      runtime.onResize((size) => resized.push(size));
      const snapshot = runtime.outputSnapshot();

      runtime.resize(120, 40);
      runtime.resize(0, 40);
      runtime.resize(80.5, 40);

      expect(resized).toEqual([]);
      expect(runtime.outputSnapshot()).toBe(snapshot);
    });

    it("remembers a size asked before the session starts", async () => {
      const { runtime } = create({ fakeFlags: ["--show-size"] });
      runtime.resize(100, 30);
      await runtime.start("x");
      expect(runtime.outputSnapshot()).toContain("[size 100x30]");
    });

    it("does nothing after the session ended", async () => {
      const { runtime } = await started();
      await runtime.stop();
      const resized: unknown[] = [];
      runtime.onResize((size) => resized.push(size));
      runtime.resize(80, 24);
      expect(resized).toEqual([]);
      expect(runtime.size).toEqual({ cols: 120, rows: 40 });
    });
  });

  it("ignores input written after the session ended instead of breaking the pipe", async () => {
    const { runtime } = await started();
    await runtime.stop();
    expect(() => runtime.writeInput("ainda aqui?\r")).not.toThrow();
  });

  it("fails when the CLI dies", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!crash")).catch(() => undefined);
    await untilState(runtime, "failed");
    expect(runtime.failureReason).toMatch(/encerrou de forma inesperada/);
  });

  it("leaves no process and no temporary file behind on stop()", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!pids Revisor"));
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
});
