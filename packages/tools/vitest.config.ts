import { defineConfig } from "vitest/config";

// MCP tests spawn real server processes; under a parallel turbo run they need room to start.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
