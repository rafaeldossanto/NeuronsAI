import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../contract/agent-runtime.js";
import { RecordingCommunication, untilState } from "../testing/fake-claude-support.js";
import { codexTestDeps } from "../testing/fake-codex-support.js";
import { CodexLoginRequiredError } from "./codex-cli.js";
import { CodexTerminalRuntime, type TerminalTimings } from "./codex-terminal-runtime.js";

/** Short waits: the fake CLI repaints at once. */
const FAST: Partial<TerminalTimings> = {
  bootTimeoutMs: 90_000,
  userDialogTimeoutMs: 1_500,
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

describe("CodexTerminalRuntime (fake CLI in a PTY)", () => {
  const live: CodexTerminalRuntime[] = [];
  let communication = new RecordingCommunication();

  function create(
    options: {
      fakeFlags?: string[];
      timings?: Partial<TerminalTimings>;
      trustWorkingDirectory?: boolean;
    } = {},
  ) {
    const deps = codexTestDeps({ fakeFlags: options.fakeFlags ?? [] });
    const runtime = new CodexTerminalRuntime(
      { name: "Pesquisador", cwd: process.cwd(), args: [], effort: "low" },
      communication,
      deps,
      {
        timings: { ...FAST, ...options.timings },
        ...(options.trustWorkingDirectory && { trustWorkingDirectory: true }),
      },
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

  it("starts idle once the screen is quiet with nothing running", async () => {
    const { runtime } = await started();
    expect(runtime.state).toBe("idle");
    expect(runtime.outputSnapshot()).toContain("? for shortcuts");
  });

  it("injects a message (typed, echoed, confirmed) and goes idle at the notify of the CLI", async () => {
    const { runtime } = await started();

    await runtime.deliver(message("!send Revisor ola"));
    expect(runtime.state).toBe("busy");
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "ola" }]);
  });

  it("injects a multi-line message through bracketed paste", async () => {
    const { runtime } = await started();

    await runtime.deliver(message("primeira linha\n!send Revisor ok\n!finish feito"));
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "ok" }]);
    expect(communication.finished).toEqual(["feito"]);
  });

  it("presses Enter again when the first one was not taken", async () => {
    const { runtime } = await started({ fakeFlags: ["--ignore-first-enter"] });

    await runtime.deliver(message("!sleep 400\n!send Revisor depois-do-segundo-enter"));
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "depois-do-segundo-enter" }]);
  });

  it("is waiting_reply while an ask blocks, then resumes the turn with the answer", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!ask Revisor tudo certo?\n!send Revisor resposta=$last"));

    await untilState(runtime, "waiting_reply");
    communication.answerAsk("sim");
    await untilState(runtime, "idle");

    expect(communication.asked).toEqual([{ to: "Revisor", question: "tudo certo?" }]);
    expect(communication.sent).toEqual([{ to: "Revisor", text: "resposta=sim" }]);
  });

  it("goes idle by the screen alone when the notify never comes", async () => {
    const { runtime } = await started({ fakeFlags: ["--never-notify"] });

    await runtime.deliver(message("!sleep 300\n!send Revisor sem-aviso"));
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Revisor", text: "sem-aviso" }]);
  });

  it("keeps the session files in a private folder and removes them with the agent", async () => {
    const { runtime } = await started();
    const folder = runtime.sessionDirectory;
    expect(folder && existsSync(folder)).toBe(true);
    await runtime.stop();
    expect(folder && existsSync(folder)).toBe(false);
  });

  it("fails with a hint when the CLI shows its sign-in screen", async () => {
    const { runtime } = create({ fakeFlags: ["--login-screen"] });
    await expect(runtime.start("x")).rejects.toThrow(CodexLoginRequiredError);
    expect(runtime.failureReason).toMatch(/codex login/);
  });

  it("does not answer the trust dialog for the user, and says what to do", async () => {
    const { runtime } = create({ fakeFlags: ["--trust-dialog"] });
    await expect(runtime.start("x")).rejects.toThrow(/confiar na pasta/);
  });

  it("answers the trust dialog only when the caller says the folder is its own", async () => {
    const { runtime } = await started({
      fakeFlags: ["--trust-dialog"],
      trustWorkingDirectory: true,
    });
    expect(runtime.state).toBe("idle");
  });
});
