import { defineConfig } from "vitest/config";

// The database suites (*.int.test.ts) against a real Postgres 18 in Docker. They run on the
// embedded PGlite as part of `test` (vitest.config.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["src/database/testing/postgres-global-setup.ts"],
    provide: { databaseKind: "postgres" },
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
