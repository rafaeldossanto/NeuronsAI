import { z } from "zod";

/** A moment, as ISO 8601 text in UTC. */
export const timestampSchema = z.iso.datetime();

export const idParamsSchema = z.object({ id: z.uuid() });

/** A page size: `?limit=` with a default and a ceiling. */
export const limitQuery = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

export const toIso = (date: Date): string => date.toISOString();
export const toIsoOrNull = (date: Date | null): string | null => (date ? toIso(date) : null);
