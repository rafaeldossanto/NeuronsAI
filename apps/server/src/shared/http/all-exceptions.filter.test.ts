import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { GraphNotFoundError } from "../../graphs/graphs.errors.js";
import { DatabaseNotConfiguredError } from "../../database/database-not-configured.error.js";
import { SecretDecryptionError } from "../../secrets/secrets.errors.js";
import { toHttpError } from "./all-exceptions.filter.js";

describe("toHttpError", () => {
  it("maps domain errors by kind, keeping their code and message", () => {
    expect(toHttpError(new GraphNotFoundError("g1"))).toEqual({
      status: 404,
      body: { code: "graph_not_found", message: 'Grafo "g1" não encontrado.' },
    });
    expect(toHttpError(new DatabaseNotConfiguredError()).status).toBe(503);
    expect(toHttpError(new SecretDecryptionError("x")).status).toBe(500);
  });

  it("maps framework HTTP exceptions to a { code, message } body", () => {
    expect(toHttpError(new NotFoundException("Cannot GET /nope"))).toEqual({
      status: 404,
      body: { code: "route_not_found", message: "Cannot GET /nope" },
    });
    expect(toHttpError(new BadRequestException("bad")).body.code).toBe("bad_request");
  });

  it("hides the details of unexpected errors", () => {
    const result = toHttpError(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));

    expect(result).toEqual({
      status: 500,
      body: { code: "internal_error", message: "Erro interno do servidor." },
    });
  });
});
