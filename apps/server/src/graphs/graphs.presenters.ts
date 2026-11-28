import type { GraphAccessDetails } from "../accounts/graph-access-admin.service.js";
import { canReadDraft } from "../accounts/graph-access.js";
import type { GraphAccessView } from "../accounts/graph-access.service.js";
import { toIso, toIsoOrNull } from "../api/common-schemas.js";
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

export const presentGraphSummary = (
  graph: GraphRecord,
  access: GraphAccessView,
  request?: GraphDeletionRequestRecord,
) => ({
  ...presentGraphFields(graph),
  ...access,
  deletionRequest: request ? presentDeletionRequest(request) : null,
});

/** Who only uses the project gets the published versions, never the draft. */
export const presentGraph = (
  { graph, latestVersion }: GraphWithLatest,
  access: GraphAccessView,
) => ({
  ...presentGraphFields(graph),
  ...access,
  draft: canReadDraft(access.access.level) ? graph.draft : null,
  latestVersion,
});

export const presentGraphAccess = (details: GraphAccessDetails) => ({
  mode: details.mode,
  owner: details.owner,
  entries: details.entries.map((entry) => ({
    user: { id: entry.user.id, name: entry.user.name, email: entry.user.email },
    status: entry.status,
    level: entry.level,
    requestedAt: toIsoOrNull(entry.requestedAt),
    decidedAt: toIsoOrNull(entry.decidedAt),
  })),
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
