import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildTestGraph } from "../hub/testing/test-graph.js";
import { GraphVersionService } from "./graph-version.service.js";
import { GraphService } from "./graph.service.js";
import { GraphHasActiveRunsError, GraphNotFoundError } from "./graphs.errors.js";
import {
  InMemoryGraphRepository,
  InMemoryGraphVersionRepository,
} from "./testing/in-memory-graph-repositories.js";

function createRig() {
  const graphs = new InMemoryGraphRepository();
  const versions = new InMemoryGraphVersionRepository();
  const service = new GraphService(graphs, versions, new GraphVersionService(graphs, versions));
  return { graphs, service };
}

describe("GraphService.remove", () => {
  it("deletes a graph, published or not", async () => {
    const { graphs, service } = createRig();
    const plain = await service.create({ name: "Rascunho" });
    const published = await service.create({ name: "Publicado" });
    await service.publish(published.id, { ...buildTestGraph(), id: published.id });

    await service.remove(plain.id);
    await service.remove(published.id);

    expect(await graphs.list()).toEqual([]);
  });

  it("refuses an unknown graph", async () => {
    const { service } = createRig();
    await expect(service.remove(randomUUID())).rejects.toBeInstanceOf(GraphNotFoundError);
  });

  it("turns the triggers off before it deletes, and waits for that", async () => {
    const { graphs, service } = createRig();
    const graph = await service.create({ name: "Com gatilhos" });
    const order: string[] = [];
    service.onBeforeRemove(async (id) => {
      await Promise.resolve();
      order.push(`gatilhos desligados ${id === graph.id ? "do grafo" : "?"}`);
      expect(await graphs.findById(graph.id)).toBeDefined();
    });

    await service.remove(graph.id);
    order.push("apagado");

    expect(order).toEqual(["gatilhos desligados do grafo", "apagado"]);
    expect(await graphs.findById(graph.id)).toBeUndefined();
  });

  it("refuses while a run is going, touching neither the triggers nor the graph", async () => {
    const { graphs, service } = createRig();
    const graph = await service.create({ name: "Em andamento" });
    graphs.activeRuns.add(graph.id);
    let triggersTouched = false;
    service.onBeforeRemove(() => {
      triggersTouched = true;
      return Promise.resolve();
    });

    await expect(service.remove(graph.id)).rejects.toBeInstanceOf(GraphHasActiveRunsError);

    expect(triggersTouched).toBe(false);
    expect(await graphs.findById(graph.id)).toBeDefined();
  });

  it("answers an active run with the code and the message the screen shows", async () => {
    const { graphs, service } = createRig();
    const graph = await service.create({ name: "Em andamento" });
    graphs.activeRuns.add(graph.id);
    await expect(service.remove(graph.id)).rejects.toMatchObject({
      code: "graph_has_active_runs",
      message: "Pare as execuções em andamento antes de excluir o projeto.",
    });
  });
});
