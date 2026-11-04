import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Vault } from "../src/obsidian/vault.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "neurons-write-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("escrita confinada no cofre", () => {
  it("cria notas em pastas, edita sem perder links e recusa versão desatualizada", async () => {
    const vault = await Vault.open(root, 1024);
    await vault.createNote("Projeto/Nova", "[[Outra nota]]");
    await expect(vault.createNote("Projeto/Nova", "não sobrescrever")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await vault.editNote("Projeto/Nova", "[[Outra nota]]", "# Alteração\n[[Outra nota]]");
    await expect(vault.editNote("Projeto/Nova", "[[Outra nota]]", "antigo")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await vault.readNote("Projeto/Nova")).toBe("# Alteração\n[[Outra nota]]");
  });
  it.each([
    "../fora.md",
    ".obsidian/config.md",
    "C:/fora.md",
    "NUL.md",
    "nota.txt",
    "pasta/../fora.md",
  ])("recusa criação fora do escopo: %s", async (name) => {
    await expect((await Vault.open(root, 1024)).createNote(name, "texto")).rejects.toMatchObject({
      code: "PATH_FORBIDDEN",
    });
  });
  it("não altera nota quando o conteúdo excede o limite", async () => {
    const vault = await Vault.open(root, 10);
    await vault.createNote("Nota", "original");
    await expect(vault.editNote("Nota", "original", "a".repeat(11))).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    expect(await readFile(path.join(root, "Nota.md"), "utf8")).toBe("original");
  });
  it("recusa escrita por um link para pasta externa", async (context) => {
    const outside = await mkdtemp(path.join(tmpdir(), "neurons-outside-"));
    try {
      await writeFile(path.join(outside, "Nota.md"), "inalterado");
      try {
        await symlink(outside, path.join(root, "externo"), "junction");
      } catch {
        context.skip();
        return;
      }
      const vault = await Vault.open(root, 1024);
      await expect(vault.createNote("externo/Nova.md", "texto")).rejects.toMatchObject({
        code: "PATH_FORBIDDEN",
      });
      await expect(
        vault.editNote("externo/Nota.md", "inalterado", "alterado"),
      ).rejects.toMatchObject({ code: "PATH_FORBIDDEN" });
      expect(await readFile(path.join(outside, "Nota.md"), "utf8")).toBe("inalterado");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
