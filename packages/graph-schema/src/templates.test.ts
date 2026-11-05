import { describe, expect, it } from "vitest";
import {
  getTemplate,
  instantiateTemplate,
  listTemplates,
  migrateGraph,
  peersOf,
  validateGraph,
} from "./index.js";

const projectId = "b3e72ac7-6acd-43f8-9c4c-abd41f57838b";
const cwd = "/runner-workdir";

describe.each(listTemplates())("template $id", (template) => {
  const create = () => instantiateTemplate(template.id, { projectId, cwd });

  it("produz um grafo válido e a migração não altera a instância configurada", () => {
    const graph = create();
    expect(validateGraph(graph)).toMatchObject({ ok: true });
    expect(migrateGraph(graph)).toEqual(graph);
    expect(graph.id).toBe(projectId);
    expect(graph.id).not.toBe(template.graph.id);
    expect(template.name).not.toBe("");
    expect(template.description).not.toBe("");
    expect(template.category).not.toBe("");
    expect(
      graph.annotations.some((annotation) => annotation.kind === "note" && annotation.text),
    ).toBe(true);
  });

  it("não distribui caminho local nem cofre da máquina no catálogo", () => {
    for (const node of template.graph.nodes) {
      expect(JSON.stringify(node)).not.toContain("vaultPath");
      if (node.type === "agent" && node.runtime.kind === "terminal") {
        expect(node.runtime.cwd).toBe(".");
        expect(create().nodes.find((entry) => entry.id === node.id)).toMatchObject({
          runtime: { cwd },
        });
      }
    }
    if (template.requiresWorkdir) {
      expect(() => instantiateTemplate(template.id, { projectId })).toThrow(
        "pasta de trabalho absoluta",
      );
      expect(() => instantiateTemplate(template.id, { projectId, cwd: "." })).toThrow(
        "pasta de trabalho absoluta",
      );
    }
  });

  it("contém apenas referências de segredo, com instrução para criar as credenciais", () => {
    for (const node of template.graph.nodes) {
      if (node.type === "agent" && node.runtime.kind === "api") {
        expect(template.requiredSecrets).toContain(node.runtime.secretName);
        expect(node.runtime.access).toBe("api-key");
      }
      if (node.type === "tool" && node.tool.kind === "http") {
        expect(node.tool.headers["Authorization"]).toMatch(/^Bearer \{\{secret:[A-Z_]+\}\}$/);
        expect(node.tool.url).toContain(".invalid/");
      }
    }
    if (template.requiresApiKey)
      expect(JSON.stringify(template.graph.annotations)).toMatch(/[Cc]rie.*segredo/);
    expect(JSON.stringify(template.graph)).not.toMatch(
      /sk-(?:ant-)?[A-Za-z0-9_-]{12,}|Bearer (?!\{\{secret:)/,
    );
  });

  it("define orçamento, tempo ocioso e limites para todas as ligações", () => {
    const graph = create();
    for (const node of graph.nodes) {
      if (node.type !== "agent") continue;
      expect(node.budgetUsd).toBeGreaterThan(0);
      expect(node.idleTimeoutSec).toBeGreaterThan(0);
      expect(["claude-haiku-5-5", "claude-sonnet-5-5"]).toContain(node.runtime.model);
      expect(["low", "medium", "high"]).toContain(node.effort);
    }
    expect(graph.links.length).toBeGreaterThan(0);
    for (const link of graph.links) expect(link.maxMessages).toBeGreaterThan(0);
  });
});

describe("catálogo tipado de templates", () => {
  it("tem três ids únicos, não reaproveita fixture e não compartilha objetos mutáveis", () => {
    expect(new Set(listTemplates().map((template) => template.id)).size).toBe(3);
    expect(getTemplate("missing")).toBeUndefined();
    const first = listTemplates()[0]!;
    first.graph.nodes.length = 0;
    expect(getTemplate(first.id)!.graph.nodes.length).toBeGreaterThan(0);
    const graph = instantiateTemplate(first.id, { projectId });
    graph.nodes.length = 0;
    expect(getTemplate(first.id)!.graph.nodes.length).toBeGreaterThan(0);
    expect(() => instantiateTemplate(first.id, { projectId: first.graph.id })).toThrow(
      "id próprio",
    );
  });

  it("pesquisa usa apenas terminais e permite conversa nos dois sentidos", () => {
    const graph = instantiateTemplate("research-review", { projectId, cwd });
    expect(
      graph.nodes
        .filter((node) => node.type === "agent")
        .every(
          (node) => node.runtime.kind === "terminal" && node.runtime.access === "subscription",
        ),
    ).toBe(true);
    expect(peersOf(graph, "Pesquisador").canMessage.map((agent) => agent.name)).toEqual([
      "Revisor",
    ]);
    expect(peersOf(graph, "Revisor").canMessage.map((agent) => agent.name)).toEqual([
      "Pesquisador",
    ]);
  });
});
