import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../contract/agent-runtime.js";
import type { OutputDelta } from "../contract/output-stream.js";
import { readHostEnvironment } from "../platform/host-environment.js";
import { RecordingCommunication, eventually, untilState } from "../testing/fake-claude-support.js";
import { codexTestDeps, type CodexTestDepsOptions } from "../testing/fake-codex-support.js";
import { CodexLoginRequiredError, CodexWrongLoginError } from "./codex-cli.js";
import { CodexExecRuntime, toUsage } from "./codex-exec-runtime.js";

const message = (body: string, overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "m-1",
  from: "Pesquisador",
  kind: "message",
  body,
  replyTo: null,
  ...overrides,
});

describe("CodexExecRuntime (fake CLI)", () => {
  const live: CodexExecRuntime[] = [];
  let communication = new RecordingCommunication();

  function create(options: CodexTestDepsOptions & { cwd?: string; args?: string[] } = {}) {
    const deps = codexTestDeps(options);
    const runtime = new CodexExecRuntime(
      {
        name: "Revisor",
        cwd: options.cwd ?? process.cwd(),
        args: options.args ?? [],
        effort: "low",
        model: "gpt-fake",
      },
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

  it("starts idle, takes a message and goes idle again at turn.completed", async () => {
    const { runtime } = await started();
    expect(runtime.state).toBe("idle");

    await runtime.deliver(message("!send Pesquisador oi"));
    expect(runtime.state).toBe("busy");
    await untilState(runtime, "idle");

    expect(communication.sent).toEqual([{ to: "Pesquisador", text: "oi" }]);
  });

  it("resumes the same thread on the next message", async () => {
    const { runtime } = await started();
    for (const text of ["!args Pesquisador", "!args Pesquisador"]) {
      await runtime.deliver(message(text));
      await untilState(runtime, "idle");
    }
    const [first, second] = communication.sent.map((sent) => JSON.parse(sent.text) as string[]);
    expect(first).not.toContain("resume");
    expect(second?.slice(-3)).toEqual(["resume", "thread-fake-1", "-"]);
  });

  it("runs the CLI with a read-only sandbox, no approvals, the model, and never the bridge token in argv", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!args Pesquisador"));
    await untilState(runtime, "idle");

    const argv = JSON.parse(communication.sent[0]?.text ?? "[]") as string[];
    const line = argv.join(" ");
    expect(line).toContain("--sandbox read-only");
    expect(line).toContain("--model gpt-fake");
    expect(line).toContain('approval_policy="never"');
    expect(line).toContain("mcp_servers.neurons.required=true");
    expect(line).not.toMatch(/NEURONS_BRIDGE_TOKEN=|Bearer/);
  });

  it("gives the CLI only the system minimum plus the bridge, and never the host's secrets", async () => {
    const { runtime } = await started({
      host: {
        PATH: readHostEnvironment()["PATH"] ?? "",
        OPENAI_API_KEY: "segredo",
        NEURONS_MASTER_KEY: "x",
      },
    });
    await runtime.deliver(message("!env Pesquisador OPENAI_API_KEY CODEX_API_KEY"));
    await untilState(runtime, "idle");

    const report = JSON.parse(communication.sent[0]?.text ?? "{}") as {
      names: string[];
      values: Record<string, string | undefined>;
    };
    expect(report.names).toContain("NEURONS_BRIDGE_TOKEN");
    expect(report.names).not.toContain("NEURONS_MASTER_KEY");
    expect(report.values["OPENAI_API_KEY"]).toBeUndefined();
    expect(report.values["CODEX_API_KEY"]).toBeUndefined();
  });

  it("hands an API key to the CLI by its environment only (CODEX_API_KEY)", async () => {
    const { runtime } = await started({ apiKey: "sk-test-not-real" });
    await runtime.deliver(message("!args Pesquisador"));
    await untilState(runtime, "idle");
    expect(communication.sent[0]?.text).not.toContain("sk-test-not-real");

    await runtime.deliver(message("!env Pesquisador CODEX_API_KEY"));
    await untilState(runtime, "idle");
    const report = JSON.parse(communication.sent[1]?.text ?? "{}") as {
      values: Record<string, string>;
    };
    expect(report.values["CODEX_API_KEY"]).toBe("sk-test-not-real");
  });

  it("publishes the agent's messages as they are written: the free text and the body of a message", async () => {
    const { runtime } = await started();
    const seen: OutputDelta[] = [];
    runtime.onOutputDelta((delta) => seen.push(delta));

    await runtime.deliver(message("!text Vou avisar o colega.\n!send Pesquisador olá, colega"));
    await untilState(runtime, "idle");

    const joined = (channel: OutputDelta["channel"]) =>
      seen
        .filter((delta) => delta.channel === channel)
        .map((delta) => delta.delta)
        .join("");
    expect(joined("text")).toBe("Vou avisar o colega.");
    expect(joined("message")).toBe("olá, colega");
    expect(communication.sent).toEqual([{ to: "Pesquisador", text: "olá, colega" }]);
  });

  it("reports the tokens of each turn, the cached ones apart from the new input", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!peers"));
    await untilState(runtime, "idle");

    expect(communication.usage).toHaveLength(1);
    expect(communication.usage[0]).toMatchObject({
      model: "gpt-fake",
      inputTokens: 60,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheCreationTokens: 0,
    });
    expect(communication.usage[0]?.costUsd).toBeUndefined();
  });

  it("logs the tool calls of the CLI, without arguments, and leaves the Neurons tools out", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!shell\n!peers"));
    await untilState(runtime, "idle");

    expect(communication.toolCalls).toHaveLength(1);
    expect(communication.toolCalls[0]).toMatchObject({
      tool: "command_execution",
      ok: true,
      inputSummary: "[argumentos omitidos]",
    });
  });

  it("shows a pending ask as waiting_reply and goes on once it is answered", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!ask Pesquisador qual a cor?"));
    await untilState(runtime, "waiting_reply");
    communication.answerAsk("azul");
    await untilState(runtime, "idle");
    expect(communication.asked).toEqual([{ to: "Pesquisador", question: "qual a cor?" }]);
  });

  it("fails with the CLI's own message when the turn fails (a quota that ran out, for instance)", async () => {
    const { runtime } = await started({ fakeFlags: ["--fail-turn"] });
    await runtime.deliver(message("!text oi"));
    await untilState(runtime, "failed");
    expect(runtime.failureReason).toMatch(/usage limit/);
  });

  it("fails when the process ends without finishing the turn", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!crash"));
    await untilState(runtime, "failed");
    expect(runtime.failureReason).toMatch(/inesperada \(código 3\)/);
  });

  it("refuses a message while it is busy", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!sleep 300"));
    await expect(runtime.deliver(message("outra"))).rejects.toThrow(/não está ocioso/);
    await untilState(runtime, "idle");
  });

  it("does not start without a login, and says what to do", async () => {
    const { runtime } = create({ fakeFlags: ["--logged-out"] });
    await expect(runtime.start("x")).rejects.toThrow(CodexLoginRequiredError);
    expect(runtime.state).toBe("failed");
    expect(runtime.failureReason).toMatch(/codex login/);
  });

  it("refuses an API-key login for a subscription agent, but not an API-key agent", async () => {
    const wrong = create({ fakeFlags: ["--api-login"] });
    await expect(wrong.runtime.start("x")).rejects.toThrow(CodexWrongLoginError);

    const keyed = create({
      fakeFlags: ["--api-login"],
      apiKey: "sk-test-not-real",
      requireChatgpt: false,
    });
    await keyed.runtime.start("x");
    expect(keyed.runtime.state).toBe("idle");
  });

  it("refuses a working directory that does not exist", async () => {
    const { runtime } = create({ cwd: "Z:\\nao\\existe" });
    await expect(runtime.start("x")).rejects.toThrow(/não existe/);
  });

  it("stops in the middle of a turn without leaving a process behind", async () => {
    const { runtime } = await started();
    await runtime.deliver(message("!sleep 5000"));
    await eventually(() => runtime.processId !== undefined);
    await runtime.stop();
    expect(runtime.state).toBe("stopped");
    await eventually(() => runtime.processId === undefined, 10_000);
  });

  it("refuses arguments that would open the sandbox", () => {
    expect(() => create({ args: ["--yolo"] })).toThrow(/não permite/);
  });
});

describe("toUsage", () => {
  it("subtracts the cached tokens from the input, which Codex counts inside it", () => {
    expect(
      toUsage({ input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122 }, "m", 5),
    ).toEqual({
      model: "m",
      inputTokens: 315,
      outputTokens: 122,
      cacheReadTokens: 24448,
      cacheCreationTokens: 0,
      durationMs: 5,
    });
  });

  it("survives an event without usage", () => {
    expect(toUsage(undefined, undefined, 1)).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });
});
