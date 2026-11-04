import { beforeEach, describe, expect, it } from "vitest";
import { InvalidMessageError, RunNotActiveError } from "./hub.errors.js";
import { eventually } from "./testing/async-helpers.js";
import { createHubHarness, inMemoryPersistence } from "./testing/hub-harness.js";

describe("Hub.reportToolCall", () => {
  const call = {
    tool: "buscar_cliente",
    inputSummary: '{"id":"{{secret:TOKEN_CRM}}"}',
    durationMs: 42,
    ok: true,
  };
  let persistence: ReturnType<typeof inMemoryPersistence>;
  let harness: ReturnType<typeof createHubHarness>;
  let runId: string;

  beforeEach(async () => {
    persistence = inMemoryPersistence();
    harness = createHubHarness(persistence);
    runId = await harness.openRun();
  });

  it("stores a ToolCalled event for the agent, with a seq, and publishes it after the commit", async () => {
    await harness.hub.reportToolCall(runId, "Alfa", call);

    const [event] = persistence.runLog.eventsOf(runId, "ToolCalled");
    expect(event).toMatchObject({
      type: "ToolCalled",
      agent: "Alfa",
      seq: 1,
      payload: { ...call, errorCode: null },
    });
    expect(harness.published.filter((published) => published.type === "ToolCalled")).toHaveLength(
      1,
    );
  });

  it("writes the error code of a call that failed, and a null when it did not", async () => {
    await harness.hub.reportToolCall(runId, "Alfa", { ...call, ok: false, errorCode: "TIMEOUT" });

    const [event] = persistence.runLog.eventsOf(runId, "ToolCalled");
    expect(event?.payload).toMatchObject({ ok: false, errorCode: "TIMEOUT" });
  });

  it("keeps a placeholder as the name of the secret and cuts what is too long", async () => {
    const long = `{{secret:TOKEN_CRM}} ${"x".repeat(5_000)}`;

    await harness.hub.reportToolCall(runId, "Alfa", {
      ...call,
      tool: "t".repeat(300),
      inputSummary: long,
    });

    const [event] = persistence.runLog.eventsOf(runId, "ToolCalled");
    const payload = event?.payload as { tool: string; inputSummary: string };
    expect(payload.tool).toHaveLength(100);
    expect(payload.inputSummary).toHaveLength(1_000);
    expect(payload.inputSummary.startsWith("{{secret:TOKEN_CRM}} ")).toBe(true);
    expect(payload.inputSummary.endsWith("…")).toBe(true);
  });

  it("counts as activity of the agent, so the idle watchdog sees it", async () => {
    const seen: string[] = [];
    harness.hub.agentActive.subscribe(({ agent }) => void seen.push(agent));

    await harness.hub.reportToolCall(runId, "Beta", call);

    expect(seen).toEqual(["Beta"]);
  });

  it("refuses an agent that is not in the graph and a run that is not active", async () => {
    await expect(harness.hub.reportToolCall(runId, "Fantasma", call)).rejects.toBeInstanceOf(
      InvalidMessageError,
    );
    await expect(
      harness.hub.reportToolCall("0192f1c0-0000-7000-8000-00000000ffff", "Alfa", call),
    ).rejects.toBeInstanceOf(RunNotActiveError);
    expect(persistence.runLog.eventsOf(runId, "ToolCalled")).toEqual([]);
  });

  it("is also accepted while the run winds down", async () => {
    harness.registry.close(runId);

    await harness.hub.reportToolCall(runId, "Alfa", call);

    expect(persistence.runLog.eventsOf(runId, "ToolCalled")).toHaveLength(1);
  });

  it("comes from the agent's own communication, bound to its run and name", async () => {
    harness.runtimes.setScript("Beta", (turn) => turn.toolCall({ tool: "http_crm", ok: false }));

    await harness.hub.send(runId, "@human", "Beta", "message", "oi");

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "ToolCalled")).toHaveLength(1),
    );
    expect(persistence.runLog.eventsOf(runId, "ToolCalled")).toMatchObject([
      { agent: "Beta", payload: { tool: "http_crm", ok: false } },
    ]);
  });
});
