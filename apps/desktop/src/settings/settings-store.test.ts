import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "./settings-store.js";

describe("DesktopSettingsStore", () => {
  let dir: string;
  let store: DesktopSettingsStore;
  const file = () => path.join(dir, "desktop-settings.json");

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "neurons-settings-"));
    store = new DesktopSettingsStore(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("starts with the triggers off, on the default port", async () => {
    expect(await store.load()).toEqual({ triggers: { enabled: false, port: 3101 } });
  });

  it("keeps what was saved, across a new store over the same folder", async () => {
    await store.saveTriggers({ enabled: true, port: 4100 });
    expect(await new DesktopSettingsStore(dir).load()).toEqual({
      triggers: { enabled: true, port: 4100 },
    });
  });

  it("writes in a folder that does not exist yet, and leaves no temporary file behind", async () => {
    const nested = path.join(dir, "ainda", "nao-existe");
    await new DesktopSettingsStore(nested).saveTriggers({ enabled: true, port: 4100 });
    expect(await readdir(nested)).toEqual(["desktop-settings.json"]);
  });

  it.each([
    ["not JSON", "{quebrado"],
    ["a port out of range", JSON.stringify({ triggers: { enabled: true, port: 80 } })],
    [
      "extra fields in the triggers",
      JSON.stringify({ triggers: { enabled: true, port: 3101, host: "0.0.0.0" } }),
    ],
    ["the wrong type", JSON.stringify({ triggers: "ligado" })],
  ])("falls back to the defaults, off, when the file has %s", async (_name, content) => {
    await writeFile(file(), content);
    expect(await store.load()).toEqual({ triggers: { enabled: false, port: 3101 } });
  });

  it("rewrites a broken file instead of failing", async () => {
    await writeFile(file(), "{quebrado");
    await store.saveTriggers({ enabled: true, port: 4100 });
    expect((await store.load()).triggers).toEqual({ enabled: true, port: 4100 });
  });

  it("keeps the fields it does not know when it saves", async () => {
    await writeFile(
      file(),
      JSON.stringify({ futuro: { x: 1 }, triggers: { enabled: false, port: 3101 } }),
    );
    await store.saveTriggers({ enabled: true, port: 4200 });
    const saved = JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;
    expect(saved).toEqual({ futuro: { x: 1 }, triggers: { enabled: true, port: 4200 } });
  });

  it("refuses to save a choice that would not load back", async () => {
    await expect(store.saveTriggers({ enabled: true, port: 80 })).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
