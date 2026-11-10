import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `test` runs the unit tests plus the database suites (*.int.test.ts) on the embedded PGlite, which
// needs no Docker. The same suites run on Postgres through vitest.integration.config.ts.
export default defineConfig({
  resolve: {
    // The outbound guard of a public server lives in @neurons/tools. The tests run its source, never
    // a `dist` older than the checkout: a stale build made the guard look absent and failed the SSRF
    // tests (graph-tools-outbound) on a machine that had not rebuilt.
    alias: {
      "@neurons/tools": fileURLToPath(
        new URL("../../packages/tools/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Booting PGlite (WASM + initdb) takes seconds, several times that on a busy machine (turbo runs
    // suites side by side), and a full run (memory-execution) boots a runner and a child process too.
    // The budget lives here, not in each test: it only decides when to give up, never what is asserted.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts", "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "embedded",
          include: ["src/**/*.int.test.ts"],
          provide: { databaseKind: "embedded" },
        },
      },
    ],
  },
});
