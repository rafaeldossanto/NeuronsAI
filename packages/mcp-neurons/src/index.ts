import { fileURLToPath } from "node:url";

export * from "./protocol.js";
export { BridgeCallError, BridgeClient } from "./bridge-client.js";
export { McpConfigError, loadMcpConfig, type McpConfig } from "./config.js";
export { createNeuronsServer } from "./server.js";

/** Absolute path of the script the agent's CLI must run (with `node`) to get the `neurons` tools. */
export const neuronsServerEntry = (): string =>
  fileURLToPath(new URL("./main.js", import.meta.url));
