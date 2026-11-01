import { describe, expect, it } from "vitest";
import { peersOf } from "./queries/peers-of.js";
import { toolsOf } from "./queries/tools-of.js";
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
