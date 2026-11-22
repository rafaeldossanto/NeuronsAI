import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resourceScope, type ResourceScope } from "../accounts/resource-scope.js";
import { GraphDeletionService } from "./graph-deletion.service.js";
import { GraphVersionService } from "./graph-version.service.js";
import { GraphService } from "./graph.service.js";
import {
  InMemoryGraphRepository,
  InMemoryGraphVersionRepository,
} from "./testing/in-memory-graph-repositories.js";
import { InMemoryGraphDeletionRequestRepository } from "./testing/in-memory-graph-deletion-requests.js";

const organizationId = randomUUID();
const bruno = randomUUID();
const ana = randomUUID();
const asMember = (userId: string): ResourceScope => ({ organizationId, role: "member", userId });
const asAdmin: ResourceScope = { organizationId, role: "admin", userId: ana };

function createRig() {
  const graphs = new InMemoryGraphRepository();
  const versions = new InMemoryGraphVersionRepository();
  const requests = new InMemoryGraphDeletionRequestRepository();
  requests.names.set(bruno, "Bruno");
  const service = new GraphService(graphs, versions, new GraphVersionService(graphs, versions));
  const deletions = new GraphDeletionService(service, requests);
  return { graphs, requests, service, deletions };
}

describe("GraphDeletionService", () => {
  it("lets a member ask once; owners and admins do not ask", async () => {
    const { service, deletions } = createRig();
    const graph = await service.create({ name: "Projeto" });

    const request = await resourceScope.run(asMember(bruno), () => deletions.request(graph.id));
    expect(request).toMatchObject({
      graphId: graph.id,
      requestedBy: bruno,
      requesterName: "Bruno",
    });

    await expect(
      resourceScope.run(asMember(bruno), () => deletions.request(graph.id)),
    ).rejects.toMatchObject({ code: "deletion_request_pending" });
    await expect(
      resourceScope.run(asAdmin, () => deletions.request(graph.id)),
    ).rejects.toMatchObject({ code: "deletion_request_not_needed" });
  });

  it("has no requests without accounts (no role, no user)", async () => {
    const { service, deletions } = createRig();
    const graph = await service.create({ name: "Local" });
    await expect(deletions.request(graph.id)).rejects.toMatchObject({
      code: "deletion_requests_unavailable",
    });
    await expect(deletions.cancel(graph.id)).rejects.toMatchObject({
      code: "deletion_requests_unavailable",
    });
  });

  it("cancels only for who asked", async () => {
    const { service, deletions, requests } = createRig();
    const graph = await service.create({ name: "Projeto" });
    await resourceScope.run(asMember(bruno), () => deletions.request(graph.id));

    await expect(
      resourceScope.run(asMember(randomUUID()), () => deletions.cancel(graph.id)),
    ).rejects.toMatchObject({ code: "deletion_request_not_yours" });
    await resourceScope.run(asMember(bruno), () => deletions.cancel(graph.id));
    expect(requests.pending.size).toBe(0);
    await expect(
      resourceScope.run(asMember(bruno), () => deletions.cancel(graph.id)),
    ).rejects.toMatchObject({ code: "deletion_request_not_found" });
  });

  it("rejects without deleting, and a member cannot reject or approve", async () => {
    const { service, graphs, deletions, requests } = createRig();
    const graph = await service.create({ name: "Projeto" });
    await resourceScope.run(asMember(bruno), () => deletions.request(graph.id));

    await expect(
      resourceScope.run(asMember(bruno), () => deletions.reject(graph.id)),
    ).rejects.toMatchObject({ code: "organization_access_denied" });
    await expect(
      resourceScope.run(asMember(bruno), () => deletions.approve(graph.id)),
    ).rejects.toMatchObject({ code: "organization_access_denied" });

    await resourceScope.run(asAdmin, () => deletions.reject(graph.id));
    expect(requests.pending.size).toBe(0);
    expect(await graphs.findById(graph.id)).toBeDefined();
    await expect(
      resourceScope.run(asAdmin, () => deletions.reject(graph.id)),
    ).rejects.toMatchObject({ code: "deletion_request_not_found" });
  });

  it("approves by deleting the project after turning the triggers off", async () => {
    const { service, graphs, deletions } = createRig();
    const graph = await service.create({ name: "Projeto" });
    const order: string[] = [];
    service.onBeforeRemove(() => {
      order.push("gatilhos desligados");
      return Promise.resolve();
    });
    await resourceScope.run(asMember(bruno), () => deletions.request(graph.id));

    await resourceScope.run(asAdmin, () => deletions.approve(graph.id));

    expect(order).toEqual(["gatilhos desligados"]);
    expect(await graphs.findById(graph.id)).toBeUndefined();
  });

  it("refuses to approve while a run is going, and the request stays pending", async () => {
    const { service, graphs, deletions, requests } = createRig();
    const graph = await service.create({ name: "Projeto" });
    graphs.activeRuns.add(graph.id);
    await resourceScope.run(asMember(bruno), () => deletions.request(graph.id));

    await expect(
      resourceScope.run(asAdmin, () => deletions.approve(graph.id)),
    ).rejects.toMatchObject({ code: "graph_has_active_runs" });

    expect(requests.pending.has(graph.id)).toBe(true);
    expect(await graphs.findById(graph.id)).toBeDefined();
  });

  it("answers an unknown graph with not found", async () => {
    const { deletions } = createRig();
    await expect(
      resourceScope.run(asAdmin, () => deletions.approve(randomUUID())),
    ).rejects.toMatchObject({ code: "graph_not_found" });
    await expect(
      resourceScope.run(asMember(bruno), () => deletions.request(randomUUID())),
    ).rejects.toMatchObject({ code: "graph_not_found" });
  });
});
