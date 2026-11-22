import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarStore } from "./avatar-store.js";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOxkAAAAASUVORK5CYII=";
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function setup() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "neurons-avatar-"));
  folders.push(folder);
  return { folder, store: new AvatarStore(folder) };
}

describe("imagem do perfil local", () => {
  it("persiste entre instâncias, sem depender da porta do servidor", async () => {
    const { folder, store } = await setup();
    expect(await store.load()).toBeNull();
    await store.save(image);
    expect(await new AvatarStore(folder).load()).toBe(image);
  });
  it("recusa conteúdo inválido ou grande e preserva a imagem anterior", async () => {
    const { store } = await setup();
    await store.save(image);
    for (const value of [
      null,
      "https://example.invalid/avatar.png",
      "data:image/png;base64,eA==",
      image + "A".repeat(512 * 1024),
    ])
      await expect(store.save(value)).rejects.toThrow("inválida");
    expect(await store.load()).toBe(image);
  });
  it("um arquivo corrompido usa o ícone padrão e pode ser substituído", async () => {
    const { folder, store } = await setup();
    await writeFile(path.join(folder, "profile-avatar.txt"), "corrompido");
    expect(await store.load()).toBeNull();
    await store.save(image);
    expect(await readFile(path.join(folder, "profile-avatar.txt"), "utf8")).toBe(image);
  });
});
