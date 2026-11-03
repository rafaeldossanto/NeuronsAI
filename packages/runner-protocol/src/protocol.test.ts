import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
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
