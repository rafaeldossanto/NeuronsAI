import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTools, InMemorySecretResolver, type Tool, type ToolSet } from "../src/index.js";
import { contentOf, errorCodeOf, findTool, testContext, toolNode } from "./support.js";

let sandbox: string;
let vaultDir: string;
let outsideFile: string;
let toolSet: ToolSet;
const unsupported = new Set<"symlink" | "junction">();

const secrets = new InMemorySecretResolver();

async function write(relative: string, content: string): Promise<void> {
  const file = path.join(vaultDir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function call(tool: Tool, input: unknown) {
  return tool.execute(input, testContext({ secrets }));
}

async function trySymlink(
  label: "symlink" | "junction",
  target: string,
  link: string,
  type: "file" | "junction",
): Promise<void> {
  try {
    await symlink(target, link, type);
  } catch {
    unsupported.add(label);
    console.warn(`AVISO: sem permissão para criar ${label}; esse caso de fuga foi ignorado.`);
  }
}

beforeAll(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "neurons-vault-"));
  vaultDir = path.join(sandbox, "vault");
  outsideFile = path.join(sandbox, "segredo.md");
  await writeFile(outsideFile, "conteudoexterno fora do cofre");
  await mkdir(vaultDir);

  await write("Receitas/Bolo de cenoura.md", "# Bolo\nCenoura, farinha e açúcar. Veja [[Açúcar]].");
  await write("Receitas/Pão.md", "Pão simples com farinha.\nCenoura não vai aqui.");
  await write("Açúcar.md", "Cenoura cenoura cenoura cenoura.");
  await write(
    "Links.md",
    [
      "Wikilink [[Nota Simples]], com alias [[Receitas/Pão|o pão]],",
      "seção [[Açúcar#Origem]], bloco [[Açúcar#^abc|apelido]], local [[#Topo]],",
      "embed ![[Diagrama]], markdown [texto](Receitas/P%C3%A3o.md#Receita),",
      "externo [site](https://exemplo.com) e imagem ![foto](foto.png).",
      "`[[em código]]`",
      "```",
      "[[bloco de código]]",
      "```",
    ].join("\n"),
  );
  await write(".obsidian/config.md", "configuração secreta");
  await write(".trash/Apagada.md", "lixeira");
  await write("Anexo.txt", "não é nota");
  await write("Grande.md", "x".repeat(2_000));

  await trySymlink("symlink", outsideFile, path.join(vaultDir, "atalho.md"), "file");
  await trySymlink("junction", sandbox, path.join(vaultDir, "pasta-fora"), "junction");

  toolSet = await createTools(toolNode({ kind: "obsidian", vaultPath: vaultDir, readOnly: true }), {
    secrets,
    limits: { maxNoteBytes: 1_000 },
  });
});

afterAll(async () => {
  await toolSet.close();
  await rm(sandbox, { recursive: true, force: true });
});

describe("obsidian tools", () => {
  it("expõe as três ferramentas com schema JSON", () => {
    expect(toolSet.tools.map((tool) => tool.name)).toEqual([
      "obsidian_search",
      "obsidian_read",
      "obsidian_list_links",
    ]);
    for (const tool of toolSet.tools) expect(tool.inputSchema).toMatchObject({ type: "object" });
  });

  describe("obsidian_search", () => {
    const search = () => findTool(toolSet.tools, "obsidian_search");

    it("ordena por relevância: nome do arquivo e frequência pesam mais", async () => {
      const text = contentOf(await call(search(), { query: "cenoura" }));
      const paths = [...text.matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1]);
      expect(paths).toEqual(["Receitas/Bolo de cenoura.md", "Açúcar.md", "Receitas/Pão.md"]);
    });

    it("respeita o limite e devolve um trecho", async () => {
      const text = contentOf(await call(search(), { query: "cenoura", limit: 1 }));
      expect(text.match(/^\d+\. /gm)).toHaveLength(1);
      expect(text).toContain("Cenoura, farinha");
    });

    it("não lê .obsidian nem .trash", async () => {
      const text = contentOf(await call(search(), { query: "secreta lixeira" }));
      expect(text).toBe("Nenhuma nota encontrada.");
    });

    it("não segue links simbólicos para fora do cofre", async () => {
      const text = contentOf(await call(search(), { query: "conteudoexterno" }));
      expect(text).toBe("Nenhuma nota encontrada.");
    });

    it("rejeita entrada inválida", async () => {
      expect(errorCodeOf(await call(search(), { query: "  " }))).toBe("INVALID_INPUT");
      expect(errorCodeOf(await call(search(), { query: "a", limit: 1000 }))).toBe("INVALID_INPUT");
    });
  });

  describe("obsidian_read", () => {
    const read = () => findTool(toolSet.tools, "obsidian_read");

    it("lê uma nota, com ou sem extensão e com qualquer separador", async () => {
      expect(contentOf(await call(read(), { path: "Receitas/Pão.md" }))).toContain("Pão simples");
      expect(contentOf(await call(read(), { path: "Receitas\\Pão" }))).toContain("Pão simples");
    });

    it("informa nota inexistente", async () => {
      expect(errorCodeOf(await call(read(), { path: "Nada.md" }))).toBe("NOT_FOUND");
    });

    it("recusa nota acima do limite de tamanho", async () => {
      expect(errorCodeOf(await call(read(), { path: "Grande.md" }))).toBe("FILE_TOO_LARGE");
    });

    it.each([
      ["..", "../segredo.md"],
      ["..", "Receitas/../../segredo.md"],
      ["..", "..\\segredo.md"],
      ["absoluto", "C:\\Windows\\win.ini"],
      ["absoluto", "/etc/passwd"],
      ["absoluto unc", "\\\\servidor\\share\\x.md"],
      ["unidade relativa", "C:segredo.md"],
      [".obsidian", ".obsidian/config.md"],
      [".obsidian", ".OBSIDIAN\\config.md"],
      [".trash", ".trash/Apagada.md"],
      ["fluxo alternativo", "Açúcar.md:stream"],
      ["extensão", "Anexo.txt"],
      ["vazio", ""],
      ["nulo", "Açúcar.md\0.png"],
    ])("recusa fuga por %s: %j", async (_label, requested) => {
      const result = await call(read(), { path: requested });
      expect(["PATH_FORBIDDEN", "INVALID_INPUT"]).toContain(errorCodeOf(result));
    });

    it.each([".OBSIDIAN/x.md", "sub/.Trash/x.md", ".Obsidian\\plugins\\x"])(
      "recusa pasta reservada pelo texto do caminho, sem depender do disco: %j",
      async (requested) => {
        expect(errorCodeOf(await call(read(), { path: requested }))).toBe("PATH_FORBIDDEN");
      },
    );

    it("recusa link simbólico de arquivo que aponta para fora do cofre", async (context) => {
      if (unsupported.has("symlink")) return context.skip();
      expect(errorCodeOf(await call(read(), { path: "atalho.md" }))).toBe("PATH_FORBIDDEN");
    });

    it("recusa pasta (junction/symlink) que aponta para fora do cofre", async (context) => {
      if (unsupported.has("junction")) return context.skip();
      expect(errorCodeOf(await call(read(), { path: "pasta-fora/segredo.md" }))).toBe(
        "PATH_FORBIDDEN",
      );
    });
  });

  describe("obsidian_list_links", () => {
    it("extrai wikilinks, alias, seção, embed e links Markdown internos", async () => {
      const text = contentOf(
        await call(findTool(toolSet.tools, "obsidian_list_links"), { path: "Links" }),
      );
      expect(JSON.parse(text)).toEqual([
        { kind: "wikilink", target: "Nota Simples" },
        { kind: "wikilink", target: "Receitas/Pão", alias: "o pão" },
        { kind: "wikilink", target: "Açúcar", section: "Origem" },
        { kind: "wikilink", target: "Açúcar", section: "^abc", alias: "apelido" },
        { kind: "wikilink", target: "", section: "Topo" },
        { kind: "embed", target: "Diagrama" },
        { kind: "markdown", target: "Receitas/Pão.md", section: "Receita" },
      ]);
    });

    it("aplica as mesmas regras de confinamento", async () => {
      const links = findTool(toolSet.tools, "obsidian_list_links");
      expect(errorCodeOf(await call(links, { path: "../segredo.md" }))).toBe("PATH_FORBIDDEN");
    });
  });

  it("registra as chamadas sem expor segredos no resumo", async () => {
    const ctx = testContext({ secrets });
    await findTool(toolSet.tools, "obsidian_read").execute(
      { path: "Açúcar.md", apiKey: "valor-sensivel" },
      ctx,
    );
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({ tool: "obsidian_read", ok: true });
    expect(ctx.calls[0]?.inputSummary).toContain("Açúcar.md");
    expect(ctx.calls[0]?.inputSummary).not.toContain("valor-sensivel");
  });
});
