import { z } from "zod";
import { failure } from "./results.js";
import type { JsonSchema, Tool, ToolContext, ToolResult } from "./types.js";

interface ToolSpec<T> {
  /** Replaces the schema derived from `schema`, when the real contract is only known at runtime. */
  inputSchema?: JsonSchema;
  name: string;
  description: string;
  schema: z.ZodType<T>;
  run(input: T, ctx: ToolContext): Promise<ToolResult>;
}

export function toInputSchema(schema: z.ZodType): JsonSchema {
  const generated: JsonSchema = z.toJSONSchema(schema);
  return Object.fromEntries(Object.entries(generated).filter(([key]) => key !== "$schema"));
}

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "entrada"}: ${issue.message}`)
    .join("; ");
}

/** Builds a tool whose input is validated by `schema` and whose JSON Schema is derived from it. */
export function defineTool<T>(spec: ToolSpec<T>): Tool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema ?? toInputSchema(spec.schema),
    execute(input, ctx) {
      const parsed = spec.schema.safeParse(input);
      return parsed.success
        ? spec.run(parsed.data, ctx)
        : Promise.resolve(
            failure("INVALID_INPUT", `Entrada inválida — ${describeIssues(parsed.error)}`),
          );
    },
  };
}
