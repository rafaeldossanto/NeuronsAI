import { toIso } from "../api/common-schemas.js";
import type { GraphWithLatest } from "./graph.service.js";
import type { GraphRecord, GraphVersionRecord } from "./graph.records.js";

export const presentGraphSummary = (graph: GraphRecord) => ({
  id: graph.id,
  name: graph.name,
  createdAt: toIso(graph.createdAt),
  updatedAt: toIso(graph.updatedAt),
});

export const presentGraph = ({ graph, latestVersion }: GraphWithLatest) => ({
  ...presentGraphSummary(graph),
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
