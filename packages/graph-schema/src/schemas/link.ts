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
  /** Restricts this agent's access to a memory even when its block permits writes. */
  readOnly: z.boolean().optional(),
  /**
   * An agent that reads customer messages (the target of a WhatsApp trigger) gets no tool that
   * writes unless this link says so explicitly.
   */
  allowWrite: z.boolean().optional(),
});

export type LinkKind = z.infer<typeof linkKindSchema>;
export type Link = z.infer<typeof linkSchema>;
