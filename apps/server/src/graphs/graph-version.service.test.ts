import { beforeEach, describe, expect, it } from "vitest";
import mixed from "@neurons/graph-schema/examples/mixed.json" with { type: "json" };
import salesFollowup from "@neurons/graph-schema/examples/sales-followup.json" with { type: "json" };
import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { GraphVersionService } from "./graph-version.service.js";
import { GraphNotFoundError } from "./graphs.errors.js";
import {
  InMemoryGraphRepository,
  InMemoryGraphVersionRepository,
} from "./testing/in-memory-graph-repositories.js";

const fixtures = { "two-agents": twoAgents, "sales-followup": salesFollowup, mixed };

describe("GraphVersionService.publish", () => {
  let graphs: InMemoryGraphRepository;
  let versions: InMemoryGraphVersionRepository;
  let service: GraphVersionService;

  beforeEach(() => {
    graphs = new InMemoryGraphRepository();
    versions = new InMemoryGraphVersionRepository();
    service = new GraphVersionService(graphs, versions);
  });

  /** A stored graph plus a fixture definition that carries its id. */
  async function graphWith<T extends object>(fixture: T) {
    const graph = await graphs.create({ name: "Grafo de teste" });
    return { graph, definition: { ...fixture, id: graph.id } };
  }

  it.each(Object.entries(fixtures))(
    "publishes the %s fixture as version 1",
    async (_name, fixture) => {
      const { graph, definition } = await graphWith(fixture);

      const result = await service.publish(graph.id, definition);

      expect(result).toMatchObject({ ok: true, version: { graphId: graph.id, version: 1 } });
      expect(await versions.findLatest(graph.id)).toMatchObject({ definition });
    },
  );

  it("numbers consecutive publications 1, 2, 3", async () => {
    const { graph, definition } = await graphWith(twoAgents);

    for (let expected = 1; expected <= 3; expected++) {
      expect(await service.publish(graph.id, definition)).toMatchObject({
        ok: true,
        version: { version: expected },
      });
    }
    expect((await versions.listByGraph(graph.id)).map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("keeps version numbers independent between graphs", async () => {
    const first = await graphWith(twoAgents);
    const second = await graphWith(mixed);
    await service.publish(first.graph.id, first.definition);

    const result = await service.publish(second.graph.id, second.definition);

    expect(result).toMatchObject({ ok: true, version: { version: 1 } });
  });

  it("returns the validation issues and stores nothing when the graph is invalid", async () => {
    const { graph, definition } = await graphWith(twoAgents);
    const invalid = {
      ...definition,
      nodes: definition.nodes.filter((node) => node.type !== "trigger"),
    };

    const result = await service.publish(graph.id, invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
    expect(await versions.listByGraph(graph.id)).toEqual([]);
  });

  it("returns issues when the input is not a graph at all", async () => {
    const graph = await graphs.create({ name: "Grafo de teste" });

    const result = await service.publish(graph.id, { nope: true });

    expect(result).toMatchObject({ ok: false });
    expect(await versions.listByGraph(graph.id)).toEqual([]);
  });

  it("rejects a definition whose id belongs to another graph", async () => {
    const graph = await graphs.create({ name: "Grafo de teste" });

    const result = await service.publish(graph.id, twoAgents);

    expect(result).toMatchObject({ ok: false, issues: [{ code: "graph_id_mismatch" }] });
    expect(await versions.listByGraph(graph.id)).toEqual([]);
  });

  it("throws GraphNotFoundError for an unknown graph", async () => {
    await expect(service.publish(twoAgents.id, twoAgents)).rejects.toBeInstanceOf(
      GraphNotFoundError,
    );
  });
});
