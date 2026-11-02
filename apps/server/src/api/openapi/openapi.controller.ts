import { Controller, Get } from "@nestjs/common";
import { API_CONTROLLERS } from "../api-controllers.js";
import { buildOpenApi, type OpenApiDocument } from "./build-openapi.js";

/** Serves the OpenAPI document of the API, built from the controllers' contracts. */
@Controller()
export class OpenApiController {
  private readonly document = buildOpenApi(API_CONTROLLERS);

  @Get("openapi.json")
  get(): OpenApiDocument {
    return this.document;
  }
}
