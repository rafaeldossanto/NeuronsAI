import { describe, expect, it } from "vitest";
import mixed from "../examples/mixed.json" with { type: "json" };
import salesFollowup from "../examples/sales-followup.json" with { type: "json" };
import twoAgents from "../examples/two-agents.json" with { type: "json" };
import twoTerminals from "../examples/two-terminals.json" with { type: "json" };
import { validateGraph } from "./validation/validate-graph.js";

const fixtures: Record<string, unknown> = {
  "two-agents.json": twoAgents,
  "sales-followup.json": salesFollowup,
  "mixed.json": mixed,
  "two-terminals.json": twoTerminals,
};

describe("example fixtures", () => {
  it.each(Object.entries(fixtures))("%s is a valid graph", (_file, graph) => {
    expect(validateGraph(graph)).toMatchObject({ ok: true });
  });
});

describe("two-terminals.json", () => {
  it("pairs a pty agent with a stream-json one", () => {
    const result = validateGraph(twoTerminals);
    if (!result.ok) throw new Error("fixture must be valid");
    const modes = result.graph.nodes.flatMap((node) =>
      node.type === "agent" && node.runtime.kind === "terminal" ? [node.runtime.mode] : [],
    );
    expect(modes).toEqual(["pty", "stream-json"]);
  });
});
