import { z } from "zod";

/** One thing wrong in a request or in a graph. Never carries the offending value. */
export const errorDetailSchema = z
  .object({
    /** Where: `body.nodes.1.name`, `query.limit`... Absent when the problem is not about one field. */
    path: z.string().optional(),
    code: z.string().optional(),
    message: z.string(),
    nodeId: z.string().optional(),
    linkId: z.string().optional(),
  })
  .meta({ id: "ErrorDetail" });

/**
 * The only shape an error takes in this API, whatever raised it. `code` is stable and in English
 * (clients branch on it); `message` is pt-BR, for the user.
 */
export const errorBodySchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  })
  .meta({ id: "ErrorBody" });

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
