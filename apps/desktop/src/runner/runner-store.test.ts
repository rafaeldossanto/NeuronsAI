import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  encryptString: vi.fn((value: string) => Buffer.from(Buffer.from(value).toString("base64"))),
  decryptString: vi.fn((value: Buffer) => Buffer.from(value.toString(), "base64").toString()),
}));
vi.mock("electron", () => ({ safeStorage: storage }));
const { DesktopRunnerStore } = await import("./runner-store.js");

const runner = {
  serverOrigin: "https://neurons.example.invalid",
  mode: "personal" as const,
  id: "r1",
  name: "meu-pc",
  token: "token-falso-nao-e-segredo",
};
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "neurons-runner-store-"));
  storage.isEncryptionAvailable.mockReturnValue(true);
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("cofre do runner", () => {
  it("guarda cifrado, separado por origem e modo, e nunca em texto aberto", async () => {
    const store = new DesktopRunnerStore(directory);
    await store.save(runner);
    const [file] = await readdir(path.join(directory, "runners"));
    expect((await readFile(path.join(directory, "runners", file!))).toString()).not.toContain(
      runner.token,
    );
    expect(await store.load(runner.serverOrigin, "personal")).toEqual(runner);
    expect(await store.load(runner.serverOrigin, "organization")).toBeUndefined();
    expect(await store.load("https://outro.invalid", "personal")).toBeUndefined();
    await store.clear(runner.serverOrigin, "personal");
    expect(await store.load(runner.serverOrigin, "personal")).toBeUndefined();
  });

  it("recusa guardar sem proteção do sistema", async () => {
    storage.isEncryptionAvailable.mockReturnValue(false);
    await expect(new DesktopRunnerStore(directory).save(runner)).rejects.toThrow(
      "armazenamento protegido",
    );
  });
});
