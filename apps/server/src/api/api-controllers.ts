import type { Type } from "@nestjs/common";
import { GraphsController } from "../graphs/graphs.controller.js";
import { RunsController } from "../runs/runs.controller.js";
import { SecretsController } from "../secrets/secrets.controller.js";

/** Every controller whose endpoints have a contract; the OpenAPI document describes exactly these. */
export const API_CONTROLLERS: readonly Type[] = [
  GraphsController,
  RunsController,
  SecretsController,
];
