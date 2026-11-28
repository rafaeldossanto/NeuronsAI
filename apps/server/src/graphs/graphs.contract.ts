import { graphDefinitionSchema } from "@neurons/graph-schema";
import { z } from "zod";
import { idParamsSchema, timestampSchema } from "../api/common-schemas.js";

const graphFields = {
  id: z.uuid(),
  name: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

export const graphAccessModeSchema = z.enum(["organization", "restricted"]);
export const graphAccessLevelSchema = z.enum(["manage", "edit", "use", "view", "none"]);
export const graphGrantLevelSchema = z.enum(["use", "edit"]);

/** Who the caller is to a project: what they may do, and what they asked for (if anything). */
export const graphAccessSummarySchema = z
  .object({
    level: graphAccessLevelSchema,
    /** `pending`: waiting for the owner; `blocked`: the owner shut this person out and they cannot ask again. */
    request: z.enum(["pending", "blocked"]).nullable(),
    /** Requests waiting for a decision; only counted for who manages the project, 0 for the others. */
    pendingRequests: z.number().int().min(0),
  })
  .meta({ id: "GraphAccessSummary" });

const graphAccessFields = {
  accessMode: graphAccessModeSchema,
  owner: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  access: graphAccessSummarySchema,
};

/** A member's pending request to delete the project, waiting for an owner or admin. */
export const graphDeletionRequestSchema = z
  .object({
    requestedBy: z.object({ id: z.uuid(), name: z.string() }),
    requestedAt: timestampSchema,
  })
  .meta({ id: "GraphDeletionRequest" });

export const graphSummarySchema = z
  .object({
    ...graphFields,
    ...graphAccessFields,
    deletionRequest: graphDeletionRequestSchema.nullable(),
  })
  .meta({ id: "GraphSummary" });

export const graphSchema = z
  .object({
    ...graphFields,
    ...graphAccessFields,
    /** The work in progress; it may not be a valid graph yet. Null for who only uses the project. */
    draft: z.unknown(),
    /** Number of the latest published version; null while none was. */
    latestVersion: z.number().int().nullable(),
  })
  .meta({ id: "Graph" });

const versionFields = {
  id: z.uuid(),
  graphId: z.uuid(),
  version: z.number().int(),
  createdAt: timestampSchema,
};

export const graphVersionSummarySchema = z
  .object(versionFields)
  .meta({ id: "GraphVersionSummary" });

export const graphVersionSchema = z
  .object({ ...versionFields, definition: graphDefinitionSchema })
  .meta({ id: "GraphVersion" });

export const graphListSchema = z.object({ items: z.array(graphSummarySchema) });
export const graphVersionListSchema = z.object({ items: z.array(graphVersionSummarySchema) });

export const createGraphBody = z.object({
  name: z.string().trim().min(1).max(200),
  draft: z.unknown().optional(),
});

export const updateGraphBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Send null to clear it. */
    draft: z.unknown().optional(),
  })
  .refine((body) => body.name !== undefined || body.draft !== undefined, {
    error: "Informe ao menos um campo para alterar: name ou draft.",
  });

export const publishVersionBody = z.object({
  /** The graph to freeze. Without it the saved draft is published. */
  definition: graphDefinitionSchema.optional(),
});

const graphAccessUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().optional(),
});

export const graphAccessEntrySchema = z
  .object({
    user: graphAccessUserSchema,
    status: z.enum(["granted", "blocked", "requested"]),
    /** Set when `granted`. */
    level: graphGrantLevelSchema.nullable(),
    requestedAt: timestampSchema.nullable(),
    decidedAt: timestampSchema.nullable(),
  })
  .meta({ id: "GraphAccessEntry" });

/** Who is in, who is out and who asked, for whoever manages the project. */
export const graphAccessSchema = z
  .object({
    mode: graphAccessModeSchema,
    owner: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    entries: z.array(graphAccessEntrySchema),
  })
  .meta({ id: "GraphAccess" });

export const setGraphAccessModeBody = z.object({ mode: graphAccessModeSchema });

export const setGraphAccessBody = z
  .object({
    status: z.enum(["granted", "blocked"]),
    /** Required with `granted` (it also approves a request); ignored with `blocked`. */
    level: graphGrantLevelSchema.optional(),
  })
  .refine((body) => body.status !== "granted" || body.level !== undefined, {
    error: "Informe o nível (use ou edit) ao liberar o acesso.",
  });

export const graphAccessRequestSchema = z
  .object({ requestedAt: timestampSchema })
  .meta({ id: "GraphAccessRequest" });

export const graphAccessUserParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const graphParams = idParamsSchema;
export const graphVersionParams = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().min(1),
});

export type CreateGraphBody = z.infer<typeof createGraphBody>;
export type UpdateGraphBody = z.infer<typeof updateGraphBody>;
export type PublishVersionBody = z.infer<typeof publishVersionBody>;
export type GraphParams = z.infer<typeof graphParams>;
export type SetGraphAccessModeBody = z.infer<typeof setGraphAccessModeBody>;
export type SetGraphAccessBody = z.infer<typeof setGraphAccessBody>;
export type GraphAccessUserParams = z.infer<typeof graphAccessUserParams>;
export type GraphVersionParams = z.infer<typeof graphVersionParams>;
