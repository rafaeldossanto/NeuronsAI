import { z } from "zod";
import { defineTool } from "../core/define-tool.js";
import { ToolSetupError } from "../core/errors.js";
import type { ResolvedDeps, ToolNodeOf } from "../core/registry.js";
import { abortFailure, failure, success } from "../core/results.js";
import type { Tool, ToolResult, ToolSet } from "../core/types.js";
import { extractLinks } from "./links.js";
import { searchVault } from "./search.js";
import { Vault, VaultError } from "./vault.js";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const searchInput = z.object({
  query: z.string().trim().min(1).describe("Termos a procurar no nome e no conteúdo das notas."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Máximo de resultados (padrão ${DEFAULT_LIMIT}).`),
});

const pathInput = z.object({
  path: z.string().min(1).describe("Caminho da nota relativo ao cofre, ex.: Projetos/Ideia.md."),
});

/** Turns vault rejections into tool failures; anything else is left to `instrument`. */
async function guarded(work: () => Promise<ToolResult>, signal: AbortSignal): Promise<ToolResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VaultError) return failure(error.code, error.message);
    if (signal.aborted) return abortFailure(signal);
    throw error;
  }
}

function buildTools(vault: Vault, deps: ResolvedDeps, readOnly: boolean): Tool[] {
  const readers = [
    defineTool({
      name: "obsidian_search",
      description:
        "Busca notas do cofre Obsidian pelo nome do arquivo e pelo conteúdo, da mais relevante para a menos.",
      schema: searchInput,
      run: ({ query, limit }, ctx) =>
        guarded(async () => {
          const hits = await searchVault(
            vault,
            query,
            limit ?? DEFAULT_LIMIT,
            deps.limits.maxSearchFiles,
            ctx.signal,
          );
          if (hits.length === 0) return success("Nenhuma nota encontrada.");
          return success(
            hits.map((hit, i) => `${i + 1}. ${hit.path}\n   ${hit.snippet}`).join("\n"),
          );
        }, ctx.signal),
    }),
    defineTool({
      name: "obsidian_read",
      description: "Lê o conteúdo de uma nota (.md) do cofre Obsidian.",
      schema: pathInput,
      run: ({ path }, ctx) => guarded(async () => success(await vault.readNote(path)), ctx.signal),
    }),
    defineTool({
      name: "obsidian_list_links",
      description:
        "Lista os links de uma nota: wikilinks [[nota|alias#seção]], embeds e links Markdown internos.",
      schema: pathInput,
      run: ({ path }, ctx) =>
        guarded(async () => {
          const links = extractLinks(await vault.readNote(path));
          return success(JSON.stringify(links, null, 2));
        }, ctx.signal),
    }),
  ];
  if (readOnly) return readers;
  return [
    ...readers,
    defineTool({
      name: "obsidian_create",
      description: "Cria uma nota Markdown no cofre. Não substitui notas existentes.",
      schema: pathInput.extend({ content: z.string() }),
      run: ({ path, content }, ctx) =>
        guarded(async () => {
          await vault.createNote(path, content);
          return success("Nota criada.");
        }, ctx.signal),
    }),
    defineTool({
      name: "obsidian_edit",
      description:
        "Edita uma nota. Informe o conteúdo anterior obtido com obsidian_read para evitar sobrescrever alterações recentes.",
      schema: pathInput.extend({ previous: z.string(), content: z.string() }),
      run: ({ path, previous, content }, ctx) =>
        guarded(async () => {
          await vault.editNote(path, previous, content);
          return success("Nota atualizada.");
        }, ctx.signal),
    }),
  ];
}

export async function createObsidianTools(
  node: ToolNodeOf<"obsidian">,
  deps: ResolvedDeps,
): Promise<ToolSet> {
  let vault: Vault;
  try {
    if (!node.tool.vaultPath) throw new Error("A memória precisa ser resolvida pelo servidor.");
    vault = await Vault.open(node.tool.vaultPath, deps.limits.maxNoteBytes);
  } catch (cause) {
    throw new ToolSetupError(
      "INVALID_CONFIG",
      `Não foi possível abrir o cofre "${node.tool.vaultPath}".`,
      { cause },
    );
  }
  return { tools: buildTools(vault, deps, node.tool.readOnly), close: () => Promise.resolve() };
}
