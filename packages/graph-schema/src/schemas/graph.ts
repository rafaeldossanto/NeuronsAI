import { z } from "zod";
import { annotationSchema } from "./annotation.js";
import { linkSchema } from "./link.js";
import { nodeSchema } from "./node.js";

export const CURRENT_SCHEMA_VERSION = 1;

export const graphDefinitionSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.uuid(),
  name: z.string().min(1),
  nodes: z.array(nodeSchema),
  links: z.array(linkSchema),
  annotations: z.array(annotationSchema),
});

export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;
