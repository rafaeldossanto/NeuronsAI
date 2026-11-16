import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { testConfig } from "../shared/config/testing/test-config.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { ConnectionsService } from "./connections.controller.js";

const fakeCodex = fileURLToPath(
  new URL("../../../../packages/agent-runtimes/test-fixtures/fake-codex.mjs", import.meta.url),
);
const fakeClaude = fileURLToPath(
  new URL("../../../../packages/agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
);

const codexWith = (...flags: string[]) => ({
  command: process.execPath,
  args: [fakeCodex, ...flags],
});

describe("ConnectionsService", () => {
  const services: ConnectionsService[] = [];
  function create(overrides: Partial<AppConfig> = {}) {
    const service = new ConnectionsService(
      testConfig({
        claudeCommand: { command: process.execPath, args: [fakeClaude] },
        ...overrides,
      }),
    );
    services.push(service);
    return service;
  }
  afterEach(() => {
    for (const service of services.splice(0)) service.onApplicationShutdown();
  });

  it("shows the ChatGPT card as available, with the same fields as Claude's", async () => {
    const status = await create({ codexCommand: codexWith() }).status();
    expect(status.chatgpt).toEqual({
      available: true,
      installed: true,
      connected: true,
      signingIn: false,
      message: "Codex conectado à sua conta do ChatGPT neste computador.",
    });
    expect(Object.keys(status.chatgpt)).toEqual(expect.arrayContaining(Object.keys(status.claude)));
  });

  it("asks the CLI whether it is logged in, and tells how to connect when it is not", async () => {
    const status = await create({ codexCommand: codexWith("--logged-out") }).status();
    expect(status.chatgpt).toMatchObject({ installed: true, connected: false });
    expect(status.chatgpt.message).toMatch(/login oficial do Codex/);
  });

  it("does not count a login made with an API key as the ChatGPT subscription", async () => {
    const status = await create({ codexCommand: codexWith("--api-login") }).status();
    expect(status.chatgpt).toMatchObject({ installed: true, connected: false });
  });

  it("tells to install the Codex CLI when it is nowhere", async () => {
    const status = await create({ codexBin: "Z:\\nao\\existe\\codex.exe" }).status();
    expect(status.chatgpt).toMatchObject({ installed: false, connected: false });
    expect(status.chatgpt.message).toMatch(/npm i -g @openai\/codex/);
  });

  it("refuses to open the login off the local profile, as Claude's does", () => {
    const service = create({ profile: "hosted", codexCommand: codexWith() });
    expect(() => service.signIn("chatgpt")).toThrow(/runner/);
  });

  it("refuses the login when the CLI is not installed, naming what to install", () => {
    const service = create({ codexBin: "Z:\\nao\\existe\\codex.exe" });
    expect(() => service.signIn("chatgpt")).toThrow(/npm i -g @openai\/codex/);
  });

  it("opens the official `codex login` once, and not again while it runs", async () => {
    const service = create({ codexCommand: codexWith() });
    expect(service.signIn("chatgpt")).toEqual({ started: true });
    expect(service.signIn("chatgpt")).toEqual({ started: true });
    expect((await service.status()).chatgpt.signingIn).toBeDefined();
  });
});
