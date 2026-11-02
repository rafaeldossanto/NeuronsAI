import { z } from "zod";

/** An empty variable (as left blank in .env.example) means "not set". */
export const unlessEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

export const port = (fallback: number) =>
  unlessEmpty(z.coerce.number().int().min(1).max(65_535).default(fallback));
