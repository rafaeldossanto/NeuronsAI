import { describe, expect, it } from "vitest";
import mixed from "../examples/mixed.json" with { type: "json" };
import salesFollowup from "../examples/sales-followup.json" with { type: "json" };
import twoAgents from "../examples/two-agents.json" with { type: "json" };
import { validateGraph } from "./validation/validate-graph.js";

const fixtures: Record<string, unknown> = {
  "two-agents.json": twoAgents,
  "sales-followup.json": salesFollowup,
  "mixed.json": mixed,
};

describe("example fixtures", () => {
  it.each(Object.entries(fixtures))("%s is a valid graph", (_file, graph) => {
    expect(validateGraph(graph)).toMatchObject({ ok: true });
  });
});
