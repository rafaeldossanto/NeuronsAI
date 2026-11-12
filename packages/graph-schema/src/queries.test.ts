import { describe, expect, it } from "vitest";
import { linkBetween } from "./queries/link-between.js";
import { peersOf } from "./queries/peers-of.js";
import { writeToolsBlockedFor } from "./queries/customer-tools.js";
import { toolsOf } from "./queries/tools-of.js";
import type { ToolNode } from "./schemas/node.js";
import { agent, httpTool, link, trigger, validGraph } from "./test-support.js";

const names = (refs: { name: string }[]) => refs.map((ref) => ref.name);

describe("peersOf", () => {
  it("separates who the agent can start talking to from who can start talking to it", () => {
    const graph = validGraph(); // Alfa -> Beta
    expect(peersOf(graph, "Alfa")).toEqual({
      canMessage: [{ id: "b", name: "Beta", role: "Papel de Beta" }],
      canBeMessagedBy: [],
    });
    expect(peersOf(graph, "Beta")).toEqual({
      canMessage: [],
      canBeMessagedBy: [{ id: "a", name: "Alfa", role: "Papel de Alfa" }],
    });
  });

  it("lets both sides start a bidirectional link", () => {
    const graph = validGraph({ links: [link("l1", "a", "b", { bidirectional: true })] });
    expect(names(peersOf(graph, "Alfa").canMessage)).toEqual(["Beta"]);
    expect(names(peersOf(graph, "Alfa").canBeMessagedBy)).toEqual(["Beta"]);
    expect(names(peersOf(graph, "Beta").canMessage)).toEqual(["Alfa"]);
    expect(names(peersOf(graph, "Beta").canBeMessagedBy)).toEqual(["Alfa"]);
  });

  it("ignores tool links and resolves names ignoring case", () => {
    const graph = validGraph({
      nodes: [trigger("t1", "a"), agent("a", "Alfa"), httpTool("f")],
      links: [link("l1", "a", "f", { kind: "uses" })],
    });
    expect(peersOf(graph, "alfa")).toEqual({ canMessage: [], canBeMessagedBy: [] });
  });

  it("returns no peers for an unknown agent", () => {
    expect(peersOf(validGraph(), "Fantasma")).toEqual({ canMessage: [], canBeMessagedBy: [] });
  });
});

describe("toolsOf", () => {
  const graph = validGraph({
    nodes: [
      trigger("t1", "a"),
      agent("a", "Alfa"),
      agent("b", "Beta"),
      httpTool("f1", "Pedidos"),
      httpTool("f2", "Estoque"),
    ],
    links: [
      link("l1", "a", "b"),
      link("l2", "a", "f1", { kind: "uses" }),
      link("l3", "b", "f2", { kind: "uses" }),
    ],
  });

  it("returns only the tool nodes linked by uses from that agent", () => {
    expect(names(toolsOf(graph, "Alfa"))).toEqual(["Pedidos"]);
    expect(names(toolsOf(graph, "beta"))).toEqual(["Estoque"]);
  });

  it("returns an empty list for an unknown agent", () => {
    expect(toolsOf(graph, "Fantasma")).toEqual([]);
  });
});

describe("linkBetween", () => {
  it("finds the arrow that lets the first agent start a talk with the second", () => {
    const graph = validGraph({ links: [link("l1", "a", "b", { maxMessages: 3 })] });
    expect(linkBetween(graph, "Alfa", "Beta")?.id).toBe("l1");
    expect(linkBetween(graph, "Beta", "Alfa")).toBeUndefined();
  });

  it("finds a double arrow from either side, ignoring case", () => {
    const graph = validGraph({ links: [link("l1", "a", "b", { bidirectional: true })] });
    expect(linkBetween(graph, "beta", "ALFA")?.id).toBe("l1");
  });

  it("ignores tool links and unknown names", () => {
    const graph = validGraph({
      nodes: [trigger("t1", "a"), agent("a", "Alfa"), httpTool("f")],
      links: [link("l1", "a", "f", { kind: "uses" })],
    });
    expect(linkBetween(graph, "Alfa", "f")).toBeUndefined();
    expect(linkBetween(graph, "Alfa", "Fantasma")).toBeUndefined();
  });
});

describe("writeToolsBlockedFor", () => {
  const whatsapp = (target: string) => ({
    ...trigger("t1", target),
    kind: "whatsapp" as const,
    phoneNumberId: "106540352242922",
    appSecretName: "app-secret",
  });
  const memory = (id: string, readOnly: boolean): ToolNode => ({
    id,
    type: "tool",
    position: { x: 0, y: 0 },
    name: `Memória ${id}`,
    tool: { kind: "obsidian", memoryId: "5b440250-ceba-42f4-8ce6-717a290384c4", readOnly },
  });
  const postTool = (id: string): ToolNode => {
    const base = httpTool(id, `Post ${id}`);
    return {
      ...base,
      tool: { kind: "http", method: "POST", url: "https://a.exemplo.com", headers: {} },
    };
  };
  const mcp = (id: string): ToolNode => ({
    id,
    type: "tool",
    position: { x: 0, y: 0 },
    name: `Mcp ${id}`,
    tool: { kind: "mcp", transport: "http", url: "https://mcp.exemplo.com", allowedTools: [] },
  });
  const reply: ToolNode = {
    id: "wa",
    type: "tool",
    position: { x: 0, y: 0 },
    name: "Resposta",
    tool: { kind: "whatsapp", phoneNumberId: "106540352242922", accessTokenSecret: "token" },
  };
  const build = (linkOverrides: Record<string, unknown> = {}, trig = whatsapp("a")) =>
    validGraph({
      nodes: [
        trig,
        agent("a", "Alfa"),
        agent("b", "Beta"),
        memory("m1", false),
        memory("m2", true),
        postTool("p"),
        httpTool("g", "Consulta"),
        mcp("x"),
        reply,
      ],
      links: ["m1", "m2", "p", "g", "x", "wa"].map((to) =>
        link(`l-${to}`, "a", to, { kind: "uses", ...(to === "m1" ? linkOverrides : {}) }),
      ),
    });

  it("blocks the writing tools of the agent that a WhatsApp trigger feeds, and only those", () => {
    expect(names(writeToolsBlockedFor(build(), "Alfa")).sort()).toEqual([
      "Mcp x",
      "Memória m1",
      "Post p",
    ]);
  });

  it("leaves the reply tool, reads and read-only memories alone", () => {
    const blocked = names(writeToolsBlockedFor(build(), "Alfa"));
    expect(blocked).not.toContain("Resposta");
    expect(blocked).not.toContain("Consulta");
    expect(blocked).not.toContain("Memória m2");
  });

  it("lets a link opt in explicitly with allowWrite", () => {
    expect(names(writeToolsBlockedFor(build({ allowWrite: true }), "Alfa"))).not.toContain(
      "Memória m1",
    );
  });

  it("treats a memory made read-only by its link as a read", () => {
    expect(names(writeToolsBlockedFor(build({ readOnly: true }), "Alfa"))).not.toContain(
      "Memória m1",
    );
  });

  it("does not touch agents that no WhatsApp trigger feeds, nor graphs without one", () => {
    expect(writeToolsBlockedFor(build(), "Beta")).toEqual([]);
    expect(
      writeToolsBlockedFor(build({}, { ...whatsapp("a"), kind: "manual" } as never), "Alfa"),
    ).toEqual([]);
  });
});
