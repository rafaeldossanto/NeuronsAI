import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./bridge-client.js";
import { McpConfigError, loadMcpConfig } from "./config.js";
import { createNeuronsServer } from "./server.js";

/** Entry point the agent's CLI spawns (stdio). stdout belongs to the MCP protocol: log to stderr only. */
async function main(): Promise<void> {
  const config = loadMcpConfig();
  await createNeuronsServer(new BridgeClient(config)).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(
    error instanceof McpConfigError ? error.message : "Falha ao iniciar o MCP neurons.",
  );
  process.exit(1);
});
