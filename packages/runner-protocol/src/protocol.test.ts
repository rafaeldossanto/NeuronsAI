import { describe, expect, it } from "vitest";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  REVISION_TERMINAL_RESIZE,
  REVISION_TOOL_CALLS,
  revisionOf,
  createMemoryChannelPair,
  decodeRunnerFrame,
  decodeServerFrame,
  encodeFrame,
  type RunnerFrame,
  type ServerFrame,
} from "./index.js";

const register: RunnerFrame = {
  v: PROTOCOL_VERSION,
  type: "register",
  runner: { name: "meu-notebook" },
  capabilities: { terminal: true, streamJson: true },
  agents: [{ instanceId: "i1", state: "idle" }],
};

describe("decoding", () => {
  it("reads back what encodeFrame wrote", () => {
    expect(decodeRunnerFrame(encodeFrame(register))).toEqual({ ok: true, frame: register });
  });

  it("refuses text that is not JSON", () => {
    expect(decodeRunnerFrame("{nope")).toMatchObject({ ok: false, code: "invalid_json" });
  });

  it("refuses a version it does not speak, before looking at anything else", () => {
    const future = JSON.stringify({ v: PROTOCOL_VERSION + 1, type: "novidade", qualquer: 1 });
    expect(decodeRunnerFrame(future)).toMatchObject({ ok: false, code: "unsupported_version" });
    expect(decodeServerFrame("{}")).toMatchObject({ ok: false, code: "unsupported_version" });
  });

  it("refuses an unknown type or a field out of shape, naming where but never the value", () => {
    const unknown = decodeRunnerFrame(JSON.stringify({ v: PROTOCOL_VERSION, type: "outra" }));
    expect(unknown).toMatchObject({ ok: false, code: "invalid_frame" });

    const bad = decodeRunnerFrame(
      JSON.stringify({ ...register, agents: [{ instanceId: "i1", state: "SEGREDO" }] }),
    );
    expect(bad).toMatchObject({ ok: false, code: "invalid_frame" });
    expect(JSON.stringify(bad)).not.toContain("SEGREDO");
  });

  it("does not let a runner send a server frame, nor the other way round", () => {
    const registered: ServerFrame = {
      v: PROTOCOL_VERSION,
      type: "registered",
      runnerId: "r1",
      heartbeatIntervalMs: 1000,
      keep: [],
    };
    expect(decodeRunnerFrame(encodeFrame(registered)).ok).toBe(false);
    expect(decodeServerFrame(encodeFrame(register)).ok).toBe(false);
    expect(decodeServerFrame(encodeFrame(registered)).ok).toBe(true);
  });

  it("checks the calls of an agent by method", () => {
    const call = (body: object) =>
      decodeRunnerFrame(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "call",
          callId: "c1",
          instanceId: "i1",
          call: body,
        }),
      );
    expect(call({ method: "ask", to: "Revisor", question: "ok?" }).ok).toBe(true);
    expect(call({ method: "ask", to: "Revisor" }).ok).toBe(false);
    expect(call({ method: "rm -rf" }).ok).toBe(false);
  });
});

describe("revisions inside version 1", () => {
  it("reads a register or registered without a revision, as an older peer sends them", () => {
    expect(decodeRunnerFrame(encodeFrame(register)).ok).toBe(true);
    expect(
      decodeServerFrame(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "registered",
          runnerId: "r1",
          heartbeatIntervalMs: 1000,
          keep: [],
        }),
      ).ok,
    ).toBe(true);
    expect(revisionOf(undefined)).toBe(1);
    expect(revisionOf(2)).toBe(2);
  });

  it("carries the revision both peers announce", () => {
    const withRevision = { ...register, revision: PROTOCOL_REVISION };
    expect(decodeRunnerFrame(encodeFrame(withRevision))).toEqual({ ok: true, frame: withRevision });
    expect(decodeRunnerFrame(JSON.stringify({ ...register, revision: 0 })).ok).toBe(false);
    expect(PROTOCOL_REVISION).toBeGreaterThanOrEqual(REVISION_TOOL_CALLS);
  });

  it("a peer of an older build ignores the fields it does not know, instead of refusing the frame", () => {
    // What an older server sees of a newer runner's register: the extra field is not an error.
    const newer = { ...register, revision: PROTOCOL_REVISION, campoDoFuturo: true };
    expect(decodeRunnerFrame(JSON.stringify(newer)).ok).toBe(true);
  });

  describe("terminal resize (revision 4)", () => {
    const resize = {
      v: PROTOCOL_VERSION,
      type: "agent.resize",
      instanceId: "i1",
      cols: 90,
      rows: 30,
    };
    const resized = { ...resize, type: "agent.resized" };

    it("is a revision of its own, announced by both peers", () => {
      expect(REVISION_TERMINAL_RESIZE).toBe(4);
      expect(PROTOCOL_REVISION).toBeGreaterThanOrEqual(REVISION_TERMINAL_RESIZE);
    });

    it("reads the request (server to runner) and the confirmation (runner to server)", () => {
      expect(decodeServerFrame(JSON.stringify(resize))).toEqual({ ok: true, frame: resize });
      expect(decodeRunnerFrame(JSON.stringify(resized))).toEqual({ ok: true, frame: resized });
    });

    it("refuses sizes that are not whole, positive and bounded", () => {
      for (const bad of [
        { cols: 0 },
        { rows: -1 },
        { cols: 80.5 },
        { rows: "30" },
        { cols: 1_001 },
      ]) {
        expect(decodeServerFrame(JSON.stringify({ ...resize, ...bad })).ok).toBe(false);
        expect(decodeRunnerFrame(JSON.stringify({ ...resized, ...bad })).ok).toBe(false);
      }
    });
  });

  it("checks the report of a tool call, and bounds how much a peer can put in it", () => {
    const call = (report: object) =>
      decodeRunnerFrame(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "call",
          callId: "c1",
          instanceId: "i1",
          call: { method: "report_tool_call", report },
        }),
      );
    const ok = { tool: "consulta", inputSummary: "{}", durationMs: 3, ok: true };

    expect(call(ok).ok).toBe(true);
    expect(call({ ...ok, errorCode: "TIMEOUT", ok: false }).ok).toBe(true);
    expect(call({ ...ok, tool: "" }).ok).toBe(false);
    expect(call({ ...ok, tool: "t".repeat(101) }).ok).toBe(false);
    expect(call({ ...ok, inputSummary: "x".repeat(1_001) }).ok).toBe(false);
    expect(call({ ...ok, durationMs: -1 }).ok).toBe(false);
    expect(call({ ...ok, durationMs: "3" }).ok).toBe(false);
  });
});

describe("memory channel pair", () => {
  it("delivers frames in order and asynchronously, through the codec", async () => {
    const { server, runner } = createMemoryChannelPair();
    const seen: string[] = [];
    server.onFrame((frame) => seen.push(frame.type));

    runner.send(register);
    runner.send({ v: PROTOCOL_VERSION, type: "heartbeat" });
    expect(seen).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["register", "heartbeat"]);
  });

  it("closing one end closes both and further sends are ignored", async () => {
    const { server, runner } = createMemoryChannelPair();
    const closed: string[] = [];
    server.onClose(() => closed.push("server"));
    runner.onClose(() => closed.push("runner"));

    runner.close(1000, "fim");
    await Promise.resolve();
    expect(closed.sort()).toEqual(["runner", "server"]);
    expect(server.isOpen).toBe(false);
    expect(() => server.send({ v: PROTOCOL_VERSION, type: "heartbeat" })).not.toThrow();
  });
});
