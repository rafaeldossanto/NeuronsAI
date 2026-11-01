import { z } from "zod";

export const idSchema = z.string().min(1);

export const positionSchema = z.object({ x: z.number(), y: z.number() });

export const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export type Position = z.infer<typeof positionSchema>;
export type Size = z.infer<typeof sizeSchema>;
