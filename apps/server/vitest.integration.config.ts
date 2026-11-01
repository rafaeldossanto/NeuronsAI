import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    // Starting a Postgres container and running migrations takes a while.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
