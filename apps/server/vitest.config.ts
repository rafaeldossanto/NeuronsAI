import { defineConfig } from "vitest/config";

// `test` runs the unit tests plus the database suites (*.int.test.ts) on the embedded PGlite, which
// needs no Docker. The same suites run on Postgres through vitest.integration.config.ts.
export default defineConfig({
  test: {
    // Booting PGlite (WASM + initdb) takes seconds, more on a busy machine.
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
