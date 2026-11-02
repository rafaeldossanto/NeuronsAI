import { graphDefinitionSchema } from "@neurons/graph-schema";
import { z } from "zod";
import { idParamsSchema, timestampSchema } from "../api/common-schemas.js";

const graphFields = {
  id: z.uuid(),
  name: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

export const graphSummarySchema = z.object(graphFields).meta({ id: "GraphSummary" });

export const graphSchema = z
  .object({
    ...graphFields,
    /** The work in progress; it may not be a valid graph yet. */
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

export const graphParams = idParamsSchema;
export const graphVersionParams = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().min(1),
});

export type CreateGraphBody = z.infer<typeof createGraphBody>;
export type UpdateGraphBody = z.infer<typeof updateGraphBody>;
export type PublishVersionBody = z.infer<typeof publishVersionBody>;
export type GraphParams = z.infer<typeof graphParams>;
export type GraphVersionParams = z.infer<typeof graphVersionParams>;
