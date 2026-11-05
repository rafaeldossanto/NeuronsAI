import type { Type } from "@nestjs/common";
import { GraphsController } from "../graphs/graphs.controller.js";
import { RunsController } from "../runs/runs.controller.js";
import { SecretsController } from "../secrets/secrets.controller.js";
import { MemoriesController } from "../memories/memories.controller.js";
import { ConnectionsController } from "../connections/connections.controller.js";
import { TriggersController } from "../triggers/triggers.controller.js";
import { AuthController } from "../accounts/auth.controller.js";
import { RunnersController } from "../runners/runners.controller.js";

/** Every controller whose endpoints have a contract; the OpenAPI document describes exactly these. */
export const API_CONTROLLERS: readonly Type[] = [
  AuthController,
  RunnersController,
  GraphsController,
  RunsController,
  SecretsController,
  MemoriesController,
  ConnectionsController,
  TriggersController,
];
