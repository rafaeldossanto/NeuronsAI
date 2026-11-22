import { toIso } from "../api/common-schemas.js";
import type { GraphDeletionRequestRecord } from "./graph-deletion-request-repository.js";
import type { GraphWithLatest } from "./graph.service.js";
import type { GraphRecord, GraphVersionRecord } from "./graph.records.js";

const presentGraphFields = (graph: GraphRecord) => ({
  id: graph.id,
  name: graph.name,
  createdAt: toIso(graph.createdAt),
  updatedAt: toIso(graph.updatedAt),
});

export const presentDeletionRequest = (request: GraphDeletionRequestRecord) => ({
  requestedBy: { id: request.requestedBy, name: request.requesterName },
  requestedAt: toIso(request.createdAt),
});

export const presentGraphSummary = (graph: GraphRecord, request?: GraphDeletionRequestRecord) => ({
  ...presentGraphFields(graph),
  deletionRequest: request ? presentDeletionRequest(request) : null,
});

export const presentGraph = ({ graph, latestVersion }: GraphWithLatest) => ({
  ...presentGraphFields(graph),
  draft: graph.draft,
  latestVersion,
});

export const presentVersionSummary = (version: GraphVersionRecord) => ({
  id: version.id,
  graphId: version.graphId,
  version: version.version,
  createdAt: toIso(version.createdAt),
});

export const presentVersion = (version: GraphVersionRecord) => ({
  ...presentVersionSummary(version),
  definition: version.definition,
});
