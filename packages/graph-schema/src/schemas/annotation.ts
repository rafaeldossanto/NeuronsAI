import { z } from "zod";
import { idSchema, positionSchema, sizeSchema } from "./common.js";

export const annotationSchema = z.object({
  id: idSchema,
  kind: z.enum(["rect", "ellipse", "arrow", "text", "note", "group"]),
  position: positionSchema,
  size: sizeSchema.optional(),
  points: z.array(positionSchema).optional(),
  text: z.string().optional(),
  style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  memberIds: z.array(idSchema).optional(),
});

export type Annotation = z.infer<typeof annotationSchema>;
