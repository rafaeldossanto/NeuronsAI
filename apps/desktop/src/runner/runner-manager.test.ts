import { describe, expect, it, vi } from "vitest";
import type { ConnectionStatus, RunningRunner, StartRunnerOptions } from "@neurons/runner";
import { RunnerIssueError } from "./runner-api.js";
import { DesktopRunnerManager } from "./runner-manager.js";
import type { RunnerMode, RunnerTokenMode } from "./runner-mode.js";
import type { StoredRunner } from "./runner-store.js";

const ORIGIN = "https://neurons.example.invalid";
const HOST = "meu-pc";
const FAKE_TOKEN = "fake-token-nao-e-segredo";

function rig(options: { mode?: RunnerMode; saved?: StoredRunner[]; hostname?: string } = {}) {
  const files = new Map<string, StoredRunner>();
  const key = (origin: string, mode: RunnerTokenMode) => `${origin}|${mode}`;
  for (const item of options.saved ?? []) files.set(key(item.serverOrigin, item.mode), item);
  const store = {
    load: vi.fn((origin: string, mode: RunnerTokenMode) =>
      Promise.resolve(files.get(key(origin, mode))),
    ),
    save: vi.fn((item: StoredRunner) => {
      files.set(key(item.serverOrigin, item.mode), item);
      return Promise.resolve();
    }),
    clear: vi.fn((origin: string, mode: RunnerTokenMode) => {
      files.delete(key(origin, mode));
      return Promise.resolve();
    }),
  };
  const api = {
    issue: vi.fn((_origin: string, mode: RunnerTokenMode, name: string) =>
      Promise.resolve({ id: `id-${mode}`, name, token: `${FAKE_TOKEN}-${mode}` }),
    ),
    revoke: vi.fn((runner: StoredRunner) => {
      void runner;
      return Promise.resolve();
    }),
  };
  const started: { options: StartRunnerOptions; stop: ReturnType<typeof vi.fn> }[] = [];
  const start = vi.fn((startOptions: StartRunnerOptions) => {
    const stop = vi.fn(() => Promise.resolve());
    started.push({ options: startOptions, stop });
    return { stop } as unknown as RunningRunner;
  });
  const saveMode = vi.fn((mode: RunnerMode) => {
    void mode;
    return Promise.resolve();
  });
  const manager = new DesktopRunnerManager({
    mode: options.mode ?? "personal",
    saveMode,
    store,
    api,
    start,
    endpoint: (origin) => `${origin.replace("https", "wss")}/runner`,
    runtime: { claudeBin: "claude-test" },
    hostname: () => options.hostname ?? HOST,
    onChange: () => undefined,
  });
  const report = (status: ConnectionStatus, index = started.length - 1) =>
    started[index]!.options.onStatus?.(status);
  return { manager, store, api, start, started, saveMode, report, files };
}

const saved = (mode: RunnerTokenMode): StoredRunner => ({
  serverOrigin: ORIGIN,
  mode,
  id: `id-${mode}`,
  name: HOST,
  token: `${FAKE_TOKEN}-saved-${mode}`,
});

describe("DesktopRunnerManager", () => {
  it("issues a personal token with the host name, stores it and starts the runner", async () => {
    const { manager, api, store, start, started, report } = rig();
    await manager.remoteChanged(ORIGIN);

    expect(api.issue).toHaveBeenCalledWith(ORIGIN, "personal", HOST);
    expect(store.save).toHaveBeenCalledWith({
      serverOrigin: ORIGIN,
      mode: "personal",
      id: "id-personal",
      name: HOST,
      token: `${FAKE_TOKEN}-personal`,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(started[0]!.options).toMatchObject({
      url: "wss://neurons.example.invalid/runner",
      token: `${FAKE_TOKEN}-personal`,
      name: HOST,
      claudeBin: "claude-test",
    });
    expect(manager.view()).toEqual({ remote: true, mode: "personal", status: "Conectando…" });
    report({ kind: "connected" });
    await vi.waitFor(() => expect(manager.view().status).toBe(`Conectado como ${HOST}`));
  });

  it("cuts a long host name to 100 characters", async () => {
    const { manager, api } = rig({ hostname: "h".repeat(150) });
    await manager.remoteChanged(ORIGIN);
    expect(api.issue).toHaveBeenCalledWith(ORIGIN, "personal", "h".repeat(100));
  });

  it("reuses the stored token instead of issuing a new one", async () => {
    const { manager, api, started } = rig({ saved: [saved("personal")] });
    await manager.remoteChanged(ORIGIN);
    expect(api.issue).not.toHaveBeenCalled();
    expect(started[0]!.options.token).toBe(`${FAKE_TOKEN}-saved-personal`);
  });

  it("does nothing in the local space and never starts a runner", async () => {
    const { manager, start, api } = rig();
    await manager.remoteChanged(null);
    expect(start).not.toHaveBeenCalled();
    expect(api.issue).not.toHaveBeenCalled();
    expect(manager.view()).toEqual({ remote: false, mode: "personal", status: "Desligado" });
  });

  it("stays off when the mode is off, without issuing anything", async () => {
    const { manager, start, api } = rig({ mode: "off" });
    await manager.remoteChanged(ORIGIN);
    expect(start).not.toHaveBeenCalled();
    expect(api.issue).not.toHaveBeenCalled();
    expect(manager.view().status).toBe("Desligado");
  });

  it("says only owner/admin join the organization on 403, keeping the chosen mode", async () => {
    const { manager, api, start, saveMode } = rig({ mode: "organization" });
    api.issue.mockRejectedValueOnce(new RunnerIssueError("forbidden"));
    await manager.remoteChanged(ORIGIN);
    expect(start).not.toHaveBeenCalled();
    expect(manager.view()).toEqual({
      remote: true,
      mode: "organization",
      status: "Só owner/admin colocam este computador na organização",
    });
    expect(saveMode).not.toHaveBeenCalled();
  });

  it("names the existing organization runner on 409", async () => {
    const { manager, api, start } = rig({ mode: "organization" });
    api.issue.mockRejectedValueOnce(new RunnerIssueError("conflict"));
    await manager.remoteChanged(ORIGIN);
    expect(start).not.toHaveBeenCalled();
    expect(manager.view().status).toBe(
      `Já existe um runner da organização chamado ${HOST}. Revogue o antigo na tela Runners.`,
    );
  });

  it("asks to sign in when there is no session, and tries again after signing in", async () => {
    const { manager, api, start } = rig();
    api.issue.mockRejectedValueOnce(new RunnerIssueError("signed-out"));
    await manager.remoteChanged(ORIGIN);
    expect(manager.view().status).toContain("Entre na sua conta");
    await manager.remoteChanged(ORIGIN);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("turns off and never issues again when the token was revoked on the web", async () => {
    const { manager, api, started, saveMode, report, files } = rig({ saved: [saved("personal")] });
    await manager.remoteChanged(ORIGIN);
    report({ kind: "refused", code: "unauthorized", message: "Token revogado." });
    await vi.waitFor(() => expect(manager.view().status).toBe("Desconectado pela web"));

    expect(started[0]!.stop).toHaveBeenCalled();
    expect(files.size).toBe(0);
    expect(saveMode).toHaveBeenCalledWith("off");
    expect(manager.view().mode).toBe("off");
    await manager.remoteChanged(ORIGIN); // reopening the app
    expect(api.issue).not.toHaveBeenCalled();
    expect(started).toHaveLength(1);
  });

  it("shows other refusals as they are, without discarding the token", async () => {
    const { manager, report, files } = rig({ saved: [saved("personal")] });
    await manager.remoteChanged(ORIGIN);
    report({ kind: "refused", code: "not_accepted", message: "Versão não aceita." });
    expect(manager.view().status).toBe("Versão não aceita.");
    expect(files.size).toBe(1);
  });

  it("revokes the previous mode's token when the mode changes, then issues the new one", async () => {
    const { manager, api, started, files, saveMode } = rig();
    await manager.remoteChanged(ORIGIN);
    await manager.setMode("organization");

    expect(saveMode).toHaveBeenCalledWith("organization");
    expect(started[0]!.stop).toHaveBeenCalled();
    expect(api.revoke).toHaveBeenCalledWith(expect.objectContaining({ mode: "personal" }));
    expect(api.issue).toHaveBeenLastCalledWith(ORIGIN, "organization", HOST);
    expect([...files.values()].map((item) => item.mode)).toEqual(["organization"]);
    expect(started[1]!.options.token).toBe(`${FAKE_TOKEN}-organization`);
  });

  it("revokes and forgets the token when turned off, even if the revocation fails", async () => {
    const { manager, api, started, files } = rig();
    await manager.remoteChanged(ORIGIN);
    api.revoke.mockRejectedValueOnce(new Error("rede"));
    await manager.setMode("off");
    expect(started[0]!.stop).toHaveBeenCalled();
    expect(api.revoke).toHaveBeenCalledTimes(1);
    expect(files.size).toBe(0);
    expect(manager.view().status).toBe("Desligado");
  });

  it("revokes and forgets the token when the app goes back to the local space", async () => {
    const { manager, api, started, files } = rig();
    await manager.remoteChanged(ORIGIN);
    await manager.remoteChanged(null);
    expect(started[0]!.stop).toHaveBeenCalled();
    expect(api.revoke).toHaveBeenCalledWith(expect.objectContaining({ mode: "personal" }));
    expect(files.size).toBe(0);
    expect(manager.view().remote).toBe(false);
  });

  it("stops the runner on close and keeps the token for the next opening", async () => {
    const { manager, api, started, files } = rig();
    await manager.remoteChanged(ORIGIN);
    await manager.close();
    expect(started[0]!.stop).toHaveBeenCalledTimes(1);
    expect(api.revoke).not.toHaveBeenCalled();
    expect(files.size).toBe(1);
  });

  it("ignores status from a runner that was already replaced", async () => {
    const { manager, report } = rig();
    await manager.remoteChanged(ORIGIN);
    await manager.setMode("off");
    report({ kind: "connected" }, 0);
    await Promise.resolve();
    expect(manager.view().status).toBe("Desligado");
  });
});
