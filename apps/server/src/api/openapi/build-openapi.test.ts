import { Controller, type Type } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_CONTROLLERS } from "../api-controllers.js";
import { Endpoint } from "../endpoint.js";
import { buildOpenApi, type OpenApiDocument } from "./build-openapi.js";

type Operation = {
  operationId: string;
  tags: string[];
  parameters?: { name: string; in: string; required: boolean }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<string, { content?: Record<string, { schema: Record<string, unknown> }> }>;
};

const operation = (document: OpenApiDocument, path: string, method: string): Operation =>
  document.paths[path]?.[method] as Operation;

describe("buildOpenApi", () => {
  const document = buildOpenApi(API_CONTROLLERS);

  it("describes every endpoint of the controllers, with Nest paths turned into OpenAPI ones", () => {
    expect(Object.keys(document.paths)).toContain("/graphs/{id}/versions/{version}");
    expect(operation(document, "/runs/{id}/stop", "post")).toMatchObject({
      operationId: "runs_stop",
      tags: ["runs"],
    });
  });

  it("takes parameters, bodies and responses from the zod contracts", () => {
    const create = operation(document, "/graphs", "post");
    expect(create.requestBody?.content["application/json"]?.schema).toMatchObject({
      type: "object",
      required: ["name"],
    });
    expect(create.responses["201"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/Graph",
    });

    const version = operation(document, "/graphs/{id}/versions/{version}", "get");
    expect(version.parameters).toEqual([
      expect.objectContaining({ name: "id", in: "path", required: true }),
      expect.objectContaining({ name: "version", in: "path", required: true }),
    ]);

    const list = operation(document, "/runs", "get");
    expect(list.parameters?.map((p) => [p.name, p.in, p.required])).toEqual([
      ["status", "query", false],
      ["graphId", "query", false],
      ["graphVersionId", "query", false],
      ["minCostUsd", "query", false],
      ["maxCostUsd", "query", false],
      ["from", "query", false],
      ["to", "query", false],
      ["sort", "query", false],
      ["order", "query", false],
      ["limit", "query", false],
      ["offset", "query", false],
    ]);
  });

  it("documents the one error shape for every error status", () => {
    expect(document.components.schemas.ErrorBody).toMatchObject({
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
    });
    const publish = operation(document, "/graphs/{id}/versions", "post");
    expect(Object.keys(publish.responses).sort()).toEqual(["201", "400", "404"]);
    for (const status of ["400", "404"]) {
      expect(publish.responses[status]?.content?.["application/json"]?.schema).toEqual({
        $ref: "#/components/schemas/ErrorBody",
      });
    }
  });

  it("keeps every reference inside the document and names the shared schemas", () => {
    const text = JSON.stringify(document);

    expect(text).not.toContain("#/$defs/");
    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining(["Graph", "GraphVersion", "RunDetail", "Message", "RunEvent"]),
    );
    const references = [...text.matchAll(/"\$ref":"#\/components\/schemas\/([A-Za-z]+)"/g)].map(
      (match) => match[1],
    );
    for (const name of references) expect(document.components.schemas).toHaveProperty(name!);
  });

  it("has no way to carry a secret's value out", () => {
    const secrets = operation(document, "/secrets", "get");
    const schema = secrets.responses["200"]?.content?.["application/json"]?.schema;
    expect(schema).toMatchObject({ properties: { names: { type: "array" } } });
    expect(JSON.stringify(schema)).not.toContain("value");
    expect(operation(document, "/secrets/{name}", "put").responses["204"]).toEqual({
      description: expect.any(String) as string,
    });
  });

  it("is the same document every time", () => {
    expect(JSON.stringify(buildOpenApi(API_CONTROLLERS))).toBe(JSON.stringify(document));
  });

  it("works for any controller that declares contracts, in the order it declares them", () => {
    @Controller("things")
    class ThingsController {
      @Endpoint({
        method: "get",
        path: ":id",
        summary: "Uma coisa.",
        params: z.object({ id: z.uuid() }),
        response: z.object({ ok: z.boolean() }),
        errors: [404],
      })
      one() {
        return { ok: true };
      }
    }

    const built = buildOpenApi([ThingsController as Type]);

    expect(Object.keys(built.paths)).toEqual(["/things/{id}"]);
  });
});
