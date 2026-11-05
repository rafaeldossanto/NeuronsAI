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
const { DesktopAccountStore } = await import("./account-store.js");
let directory: string;
const session = {
  serverOrigin: "https://neurons.example.invalid",
  refreshToken: `nsr_${"x".repeat(43)}`,
  expiresAt: "2099-01-01T00:00:00Z",
};
beforeEach(async () => {
  directory = path.resolve(await mkdtemp(path.join(os.tmpdir(), "neurons-account-store-")));
  storage.isEncryptionAvailable.mockReturnValue(true);
  storage.getSelectedStorageBackend.mockReturnValue("gnome_libsecret");
});
afterEach(async () => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^neurons-account-store-/);
  await rm(directory, { recursive: true, force: true });
});
describe("cofre de sessão desktop", () => {
  it("usa safeStorage, persiste sem texto aberto e limita a leitura à origem", async () => {
    const store = new DesktopAccountStore(directory);
    await store.save(session);
    const [file] = await readdir(path.join(directory, "accounts"));
    expect((await readFile(path.join(directory, "accounts", file!))).toString()).not.toContain(
      session.refreshToken,
    );
    expect(await new DesktopAccountStore(directory).load(session.serverOrigin)).toEqual(session);
    expect(await store.load("https://other.invalid")).toBeUndefined();
    await store.clear(session.serverOrigin);
    expect(await store.load(session.serverOrigin)).toBeUndefined();
  });
  it("recusa fallback sem criptografia e basic_text no Linux", async () => {
    storage.isEncryptionAvailable.mockReturnValue(false);
    await expect(new DesktopAccountStore(directory).save(session)).rejects.toThrow(
      "armazenamento protegido",
    );
    storage.isEncryptionAvailable.mockReturnValue(true);
    storage.getSelectedStorageBackend.mockReturnValue("basic_text");
    await expect(new DesktopAccountStore(directory, "linux").save(session)).rejects.toThrow(
      "armazenamento protegido",
    );
  });
  it("remove sessão expirada e recusa origem remota sem HTTPS", async () => {
    const store = new DesktopAccountStore(directory);
    await store.save({ ...session, expiresAt: "2000-01-01T00:00:00Z" });
    expect(await store.load(session.serverOrigin)).toBeUndefined();
    await expect(store.save({ ...session, serverOrigin: "http://other.invalid" })).rejects.toThrow(
      "HTTPS",
    );
  });
});
