import { z } from "zod";
import { idSchema } from "./common.js";

export const linkKindSchema = z.enum(["talk", "uses"]);

export const linkSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  kind: linkKindSchema,
  bidirectional: z.boolean().default(false),
  maxMessages: z.number().int().positive().optional(),
});

export type LinkKind = z.infer<typeof linkKindSchema>;
export type Link = z.infer<typeof linkSchema>;
