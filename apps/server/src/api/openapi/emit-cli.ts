import { API_CONTROLLERS } from "../api-controllers.js";
import { buildOpenApi } from "./build-openapi.js";

/**
 * Prints the OpenAPI document (JSON, a trailing newline) on stdout, built from the code alone: no
 * server, no database. `packages/api-client` runs this to generate and to check its client.
 */
process.stdout.write(`${JSON.stringify(buildOpenApi(API_CONTROLLERS), null, 2)}\n`);
