import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleGraphRepository } from "./drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "./drizzle-graph-version.repository.js";
import { GraphVersionService } from "./graph-version.service.js";

let testDb: TestDatabase;
let graphs: DrizzleGraphRepository;
let versions: DrizzleGraphVersionRepository;
let service: GraphVersionService;

beforeAll(async () => {
  testDb = await startTestDatabase();
  graphs = new DrizzleGraphRepository(testDb.database);
  versions = new DrizzleGraphVersionRepository(testDb.database);
  service = new GraphVersionService(graphs, versions);
});

afterAll(async () => {
  await testDb.stop();
});

async function newGraph() {
  const graph = await graphs.create({ name: "Grafo de integração" });
  return { graph, definition: { ...twoAgents, id: graph.id } };
}

describe("DrizzleGraphRepository", () => {
  it("creates, finds, lists and updates the draft", async () => {
    const created = await graphs.create({ name: "Rascunho", draft: { nodes: [] } });

    expect(await graphs.findById(created.id)).toMatchObject({
      name: "Rascunho",
      draft: { nodes: [] },
    });
    expect((await graphs.list()).map((g) => g.id)).toContain(created.id);

    const saved = await graphs.saveDraft(created.id, { nodes: [1] });
    expect(saved?.draft).toEqual({ nodes: [1] });
    expect(saved!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("returns undefined for unknown graphs", async () => {
    const unknown = "0192f1c0-0000-7000-8000-00000000dead";

    expect(await graphs.findById(unknown)).toBeUndefined();
    expect(await graphs.saveDraft(unknown, {})).toBeUndefined();
  });
});

describe("DrizzleGraphVersionRepository", () => {
  it("numbers versions 1, 2, 3 and stores the definition as published", async () => {
    const { graph, definition } = await newGraph();

    for (let expected = 1; expected <= 3; expected++) {
      const result = await service.publish(graph.id, definition);
      expect(result).toMatchObject({ ok: true, version: { graphId: graph.id, version: expected } });
    }

    expect((await versions.listByGraph(graph.id)).map((v) => v.version)).toEqual([1, 2, 3]);
    expect(await versions.findLatest(graph.id)).toMatchObject({ version: 3, definition });
    expect(await versions.findByVersion(graph.id, 2)).toMatchObject({ version: 2 });
    expect(await versions.findByVersion(graph.id, 9)).toBeUndefined();
  });

  it("keeps numbering independent between graphs", async () => {
    const first = await newGraph();
    const second = await newGraph();

    await service.publish(first.graph.id, first.definition);
    await service.publish(first.graph.id, first.definition);

    expect(await service.publish(second.graph.id, second.definition)).toMatchObject({
      version: { version: 1 },
    });
  });

  it("gives distinct consecutive numbers to concurrent publications", async () => {
    const { graph, definition } = await newGraph();

    await Promise.all(
      Array.from({ length: 5 }, () => versions.appendNext(graph.id, definition as never)),
    );

    expect((await versions.listByGraph(graph.id)).map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it("stores nothing when the definition is invalid", async () => {
    const { graph, definition } = await newGraph();

    const result = await service.publish(graph.id, { ...definition, nodes: [] });

    expect(result.ok).toBe(false);
    expect(await versions.listByGraph(graph.id)).toEqual([]);
  });
});
