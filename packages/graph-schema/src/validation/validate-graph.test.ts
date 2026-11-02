import { describe, expect, it } from "vitest";
import type { GraphDefinition } from "../schemas/graph.js";
import type { Annotation } from "../schemas/annotation.js";
import { agent, httpTool, link, trigger, validGraph } from "../test-support.js";
import { validateGraph } from "./validate-graph.js";

function issueCodes(graph: unknown): string[] {
  const result = validateGraph(graph);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

const group = (id: string, memberIds: string[]): Annotation => ({
  id,
  kind: "group",
  position: { x: 0, y: 0 },
  memberIds,
});

describe("validateGraph", () => {
  it("accepts a valid graph and returns it parsed", () => {
    const result = validateGraph(validGraph());
    expect(result.ok).toBe(true);
  });

  describe("schema errors", () => {
    it("reports structural problems with a path and a pt-BR message", () => {
      const result = validateGraph({ ...validGraph(), id: "nao-e-uuid" });
      expect(result).toMatchObject({
        ok: false,
        issues: [
          { code: "invalid_format", path: ["id"], message: "Identificador (uuid) inválido." },
        ],
      });
    });

    it("reports a missing field and a non-object input", () => {
      expect(issueCodes({ ...validGraph(), nodes: undefined })).toContain("invalid_type");
      expect(issueCodes(null)).toContain("invalid_type");
    });

    it("exposes the custom rule codes of the schemas", () => {
      const customCli = agent("a", "Alfa", {
        runtime: { kind: "terminal", cli: "custom", mode: "pty", args: [], cwd: "/tmp" },
      });
      const graph = validGraph({ nodes: [trigger("t1", "a"), customCli], links: [] });
      expect(issueCodes(graph)).toEqual(["command_required"]);
    });
  });

  describe("unique ids", () => {
    it("flags an id repeated across nodes, links and annotations", () => {
      const graph = validGraph({ annotations: [group("l1", [])] });
      const result = validateGraph(graph);
      expect(result).toMatchObject({
        ok: false,
        issues: [{ code: "duplicate_id", path: ["annotations", 0, "id"] }],
      });
    });
  });

  describe("unique agent names", () => {
    it("flags names that only differ by case", () => {
      const graph = validGraph({
        nodes: [trigger("t1", "a"), agent("a", "Alfa"), agent("b", "ALFA")],
        links: [],
      });
      expect(validateGraph(graph)).toMatchObject({
        ok: false,
        issues: [{ code: "duplicate_agent_name", nodeId: "b" }],
      });
    });

    it("allows a tool to share a name with an agent", () => {
      const graph = validGraph({ nodes: [...validGraph().nodes, httpTool("f", "Alfa")] });
      expect(validateGraph(graph).ok).toBe(true);
    });
  });

  describe("triggers", () => {
    it("requires at least one trigger", () => {
      const graph = validGraph({ nodes: [agent("a", "Alfa"), agent("b", "Beta")] });
      expect(issueCodes(graph)).toEqual(["missing_trigger"]);
    });

    it("requires the target to exist", () => {
      const graph = validGraph({
        nodes: [trigger("t1", "fantasma"), agent("a", "A"), agent("b", "B")],
      });
      expect(issueCodes(graph)).toEqual(["trigger_target_not_found"]);
    });

    it("requires the target to be an agent", () => {
      const graph = validGraph({
        nodes: [trigger("t1", "f"), agent("a", "Alfa"), agent("b", "Beta"), httpTool("f")],
      });
      expect(issueCodes(graph)).toEqual(["trigger_target_not_agent"]);
    });
  });

  describe("link endpoints", () => {
    it("flags links pointing to missing blocks", () => {
      const graph = validGraph({ links: [link("l1", "fantasma", "b")] });
      expect(validateGraph(graph)).toMatchObject({
        ok: false,
        issues: [{ code: "link_endpoint_not_found", path: ["links", 0, "from"], linkId: "l1" }],
      });
    });

    it("accepts talk between agents but rejects talk involving a tool or a trigger", () => {
      const nodes = [trigger("t1", "a"), agent("a", "Alfa"), agent("b", "Beta"), httpTool("f")];
      expect(issueCodes(validGraph({ nodes, links: [link("l1", "a", "f")] }))).toEqual([
        "talk_requires_agents",
      ]);
      expect(issueCodes(validGraph({ nodes, links: [link("l1", "t1", "a")] }))).toEqual([
        "talk_requires_agents",
      ]);
    });

    it("rejects a talk from an agent to itself", () => {
      expect(issueCodes(validGraph({ links: [link("l1", "a", "a")] }))).toEqual(["talk_to_self"]);
    });

    it("accepts uses from agent to tool but rejects other shapes", () => {
      const nodes = [trigger("t1", "a"), agent("a", "Alfa"), agent("b", "Beta"), httpTool("f")];
      const uses = (id: string, from: string, to: string) => link(id, from, to, { kind: "uses" });
      expect(validateGraph(validGraph({ nodes, links: [uses("l1", "a", "f")] })).ok).toBe(true);
      expect(issueCodes(validGraph({ nodes, links: [uses("l1", "f", "a")] }))).toEqual([
        "uses_requires_agent_to_tool",
      ]);
      expect(issueCodes(validGraph({ nodes, links: [uses("l1", "a", "b")] }))).toEqual([
        "uses_requires_agent_to_tool",
      ]);
    });
  });

  describe("duplicate links", () => {
    it("flags the same talk declared twice", () => {
      const graph = validGraph({ links: [link("l1", "a", "b"), link("l2", "a", "b")] });
      expect(validateGraph(graph)).toMatchObject({
        ok: false,
        issues: [{ code: "duplicate_link", linkId: "l2" }],
      });
    });

    it("flags a bidirectional talk combined with any other talk between the pair", () => {
      const bidirectional = link("l1", "a", "b", { bidirectional: true });
      expect(issueCodes(validGraph({ links: [bidirectional, link("l2", "b", "a")] }))).toEqual([
        "duplicate_link",
      ]);
      expect(
        issueCodes(validGraph({ links: [link("l1", "b", "a"), { ...bidirectional, id: "l2" }] })),
      ).toEqual(["duplicate_link"]);
    });

    it("accepts two opposite unidirectional talks and distinct kinds", () => {
      const opposite = validGraph({ links: [link("l1", "a", "b"), link("l2", "b", "a")] });
      expect(validateGraph(opposite).ok).toBe(true);
    });

    it("flags the same uses link twice", () => {
      const nodes = [trigger("t1", "a"), agent("a", "Alfa"), httpTool("f")];
      const uses = (id: string) => link(id, "a", "f", { kind: "uses" });
      expect(issueCodes(validGraph({ nodes, links: [uses("l1"), uses("l2")] }))).toEqual([
        "duplicate_link",
      ]);
    });
  });

  describe("group members", () => {
    it("accepts members that exist", () => {
      expect(validateGraph(validGraph({ annotations: [group("g", ["a", "b"])] })).ok).toBe(true);
    });

    it("flags members that do not exist", () => {
      const result = validateGraph(validGraph({ annotations: [group("g", ["a", "fantasma"])] }));
      expect(result).toMatchObject({
        ok: false,
        issues: [{ code: "group_member_not_found", path: ["annotations", 0, "memberIds", 1] }],
      });
    });
  });

  it("gathers every problem in one pass instead of stopping at the first", () => {
    const graph: GraphDefinition = validGraph({
      nodes: [agent("a", "Alfa"), agent("b", "alfa")],
      links: [link("l1", "a", "a"), link("l2", "a", "fantasma")],
      annotations: [group("g", ["fantasma"])],
    });
    expect(issueCodes(graph).sort()).toEqual([
      "duplicate_agent_name",
      "group_member_not_found",
      "link_endpoint_not_found",
      "missing_trigger",
      "talk_to_self",
    ]);
  });
});
