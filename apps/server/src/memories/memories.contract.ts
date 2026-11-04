import { z } from "zod";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_FILES = 1000;
export const memoryParams = z.object({ id: z.uuid() });
export const memorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  storage: z.enum(["local", "server"]),
  vaultPath: z.string().optional(),
  runner: z.string().optional(),
  fileCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export const memoryListSchema = z.object({ items: z.array(memorySchema) });
export const createMemoryBody = z.object({
  name: z.string().trim().min(1).max(120),
  storage: z.enum(["local", "server"]),
  vaultPath: z.string().min(1).max(4096).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(1024),
        data: z.string().max(MAX_IMPORT_BYTES * 2),
      }),
    )
    .max(MAX_IMPORT_FILES)
    .optional(),
});
export type MemoryRecord = z.infer<typeof memorySchema>;
export type CreateMemory = z.infer<typeof createMemoryBody>;
