import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRIDGE_ROUTES } from "@neurons/mcp-neurons";
import { RecordingCommunication } from "../testing/fake-claude-support.js";
import { LocalBridge } from "./local-bridge.js";

describe("LocalBridge", () => {
  let communication: RecordingCommunication;
  let bridge: LocalBridge;
  let hookCalls: string[];

  const post = (route: string, body: unknown, token: string | null = bridge.token) =>
    fetch(`${bridge.url}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    communication = new RecordingCommunication();
    hookCalls = [];
    bridge = new LocalBridge({
      communication,
      hooks: {
        onUserPromptSubmit: () => hookCalls.push("user-prompt-submit"),
        onStop: () => hookCalls.push("stop"),
      },
    });
    await bridge.start();
  });

  afterEach(() => bridge.stop());

  it("listens on loopback, on a port of its own", () => {
    expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("gives each bridge a different long random token", async () => {
    const other = new LocalBridge({ communication });
    expect(other.token).not.toBe(bridge.token);
    expect(bridge.token.length).toBeGreaterThanOrEqual(32);
  });

  it.each([
    ["no token", null],
    ["a wrong token", "x".repeat(43)],
    ["an empty token", ""],
  ])("refuses a call with %s and does not touch the Hub", async (_label, token) => {
    const response = await post(BRIDGE_ROUTES.sendMessage, { to: "Revisor", text: "oi" }, token);
    expect(response.status).toBe(401);
    expect(communication.sent).toEqual([]);
  });

  it("refuses hook notices with a wrong token too", async () => {
    const response = await post(BRIDGE_ROUTES.hooks.stop, {}, "y".repeat(43));
    expect(response.status).toBe(401);
    expect(hookCalls).toEqual([]);
  });

  it("forwards the tools to the communication", async () => {
    expect(await (await post(BRIDGE_ROUTES.sendMessage, { to: "Revisor", text: "oi" })).json()).toEqual({
      messageId: "sent-1",
    });
    expect(await (await post(BRIDGE_ROUTES.reply, { messageId: "m-1", text: "ok" })).json()).toEqual({
      messageId: "reply-1",
    });
    expect(await (await post(BRIDGE_ROUTES.finish, { result: "pronto" })).json()).toEqual({});
    expect(await (await post(BRIDGE_ROUTES.listPeers, {})).json()).toMatchObject({
      canMessage: [{ name: "Revisor" }],
    });
    expect(communication.sent).toEqual([{ to: "Revisor", text: "oi" }]);
    expect(communication.replies).toEqual([{ messageId: "m-1", text: "ok" }]);
    expect(communication.finished).toEqual(["pronto"]);
  });

  it("keeps an ask open until it is answered", async () => {
    const pending = post(BRIDGE_ROUTES.ask, { to: "Revisor", question: "e aí?" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(communication.asked).toEqual([{ to: "Revisor", question: "e aí?" }]);

    communication.answerAsk("tudo certo");
    expect(await (await pending).json()).toEqual({ answer: "tudo certo" });
  });

  it("answers a refusal of the Hub with its message, ready for the model", async () => {
    communication.sendMessage = () => Promise.reject(new Error("Você não pode escrever a Revisor."));
    const response = await post(BRIDGE_ROUTES.sendMessage, { to: "Revisor", text: "oi" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Você não pode escrever a Revisor." });
  });

  it("rejects malformed bodies and unknown routes", async () => {
    expect((await post(BRIDGE_ROUTES.sendMessage, { to: "" })).status).toBe(400);
    expect((await post("/nope", {})).status).toBe(404);
    const get = await fetch(`${bridge.url}${BRIDGE_ROUTES.listPeers}`, {
      headers: { authorization: `Bearer ${bridge.token}` },
    });
    expect(get.status).toBe(404);
  });

  it("tells the runtime about each hook the CLI posts", async () => {
    await post(BRIDGE_ROUTES.hooks.userPromptSubmit, { prompt: "oi" });
    await post(BRIDGE_ROUTES.hooks.stop, {});
    expect(hookCalls).toEqual(["user-prompt-submit", "stop"]);
  });

  it("stops listening on stop()", async () => {
    const url = bridge.url;
    await bridge.stop();
    await expect(fetch(`${url}${BRIDGE_ROUTES.listPeers}`, { method: "POST" })).rejects.toThrow();
  });
});
