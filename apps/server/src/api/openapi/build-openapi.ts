import "reflect-metadata";
import type { Type } from "@nestjs/common";
import { z } from "zod";
import { errorBodySchema } from "../../shared/http/error-body.js";
import { contractOf, type EndpointContract } from "../endpoint.js";

/** The version of the HTTP API (not of the server): bump it when a client could break. */
export const API_VERSION = "1.0.0";

type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Requisição inválida.",
  403: "Não permitido.",
  404: "Não encontrado.",
  409: "Conflito com o estado atual.",
  503: "Indisponível no momento.",
};

/** Every schema that is `$ref`-ed by name ends up in `components.schemas`, whatever endpoint used it first. */
class SchemaCollector {
  readonly schemas: Record<string, JsonSchema> = {};

  /** Converts a zod schema to JSON Schema, moving the schemas it names (`.meta({ id })`) to the components. */
  convert(schema: z.ZodType, io: "input" | "output"): JsonSchema {
    const { $defs, $schema, ...converted } = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io,
      unrepresentable: "any",
    }) as JsonSchema & { $defs?: Record<string, JsonSchema> };
    void $schema;
    for (const [name, definition] of Object.entries($defs ?? {})) {
      this.schemas[name] = relink(definition) as JsonSchema;
    }
    return relink(converted) as JsonSchema;
  }
}

const relink = (node: unknown): unknown =>
  JSON.parse(JSON.stringify(node).replaceAll('"#/$defs/', '"#/components/schemas/')) as unknown;

/**
 * Builds the OpenAPI 3.1 document from the controllers' routes and the zod contracts attached to
 * them with `@Endpoint`. Nothing is written twice: the schema that validates a request is the one
 * that documents it. The result depends only on the code, so it can be committed and compared.
 */
export function buildOpenApi(controllers: readonly Type[]): OpenApiDocument {
  const collector = new SchemaCollector();
  // Registers `ErrorBody` (and `ErrorDetail`) among the components, which every error response points to.
  collector.convert(errorBodySchema, "output");
  const paths: OpenApiDocument["paths"] = {};

  for (const controller of controllers) {
    const prefix = Reflect.getMetadata("path", controller) as string | undefined;
    for (const handlerName of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[handlerName];
      const contract = typeof handler === "function" ? contractOf(handler) : undefined;
      if (!contract) continue;

      const route = toOpenApiPath(prefix, contract.path);
      paths[route] ??= {};
      paths[route][contract.method] = describeOperation(
        `${prefix ?? "api"}_${handlerName}`,
        prefix ?? "api",
        contract,
        collector,
      );
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "NeuronsAI API",
      version: API_VERSION,
      description:
        "API do servidor do NeuronsAI. Ainda não há login: o servidor só escuta em endereços locais.",
    },
    paths: sortKeys(paths),
    components: { schemas: sortKeys(collector.schemas) },
  };
}

function describeOperation(
  operationId: string,
  tag: string,
  contract: EndpointContract,
  collector: SchemaCollector,
): unknown {
  const parameters = [
    ...parametersOf("path", contract.params, collector),
    ...parametersOf("query", contract.query, collector),
  ];
  const success = contract.status ?? 200;
  const validated = contract.params || contract.query || contract.body;
  const errors = [...(validated ? [400] : []), ...(contract.errors ?? [])];

  return {
    operationId,
    tags: [tag],
    summary: contract.summary,
    ...(parameters.length > 0 && { parameters }),
    ...(contract.body && {
      requestBody: {
        required: true,
        content: { "application/json": { schema: collector.convert(contract.body, "input") } },
      },
    }),
    responses: {
      [success]: contract.response
        ? {
            description: "Sucesso.",
            content: {
              "application/json": { schema: collector.convert(contract.response, "output") },
            },
          }
        : { description: "Sucesso, sem conteúdo." },
      ...Object.fromEntries(
        [...new Set(errors)].sort().map((status) => [
          status,
          {
            description: ERROR_DESCRIPTIONS[status] ?? "Erro.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } },
            },
          },
        ]),
      ),
    },
  };
}

function parametersOf(
  location: "path" | "query",
  schema: z.ZodObject | undefined,
  collector: SchemaCollector,
): unknown[] {
  if (!schema) return [];
  const converted = collector.convert(schema, "input") as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(converted.properties ?? {}).map(([name, property]) => ({
    name,
    in: location,
    required: location === "path" || (converted.required ?? []).includes(name),
    schema: property,
  }));
}

/** `("graphs", ":id/versions")` becomes `/graphs/{id}/versions`. */
function toOpenApiPath(prefix: string | undefined, path: string): string {
  const joined = [prefix, path].filter((part) => part).join("/");
  return `/${joined}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** By code unit, not `localeCompare`: the document must come out the same on every machine. */
const sortKeys = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
