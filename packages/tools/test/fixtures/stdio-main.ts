import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTestServer } from "./test-server.ts";

// MCP_STUBBORN=1: ignores the end of stdin and leaves a grandchild behind, like an `npx` wrapper.
// MCP_PIDFILE: where to report the pids so the test can check nothing is left running.
const pids: Record<string, number | undefined> = { server: process.pid };

if (process.env.MCP_STUBBORN === "1") {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  pids.grandchild = grandchild.pid;
  setInterval(() => {}, 1_000);
}
if (process.env.MCP_PIDFILE) writeFileSync(process.env.MCP_PIDFILE, JSON.stringify(pids));

await createTestServer().connect(new StdioServerTransport());
