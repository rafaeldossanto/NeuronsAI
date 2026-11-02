import { defineConfig } from "vitest/config";

// The tests spawn real child processes (a fake CLI, the MCP server); under a parallel turbo run
// they need room to start.
export default defineConfig({ test: { testTimeout: 90_000, hookTimeout: 90_000 } });
