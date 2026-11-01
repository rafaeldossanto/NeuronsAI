import { defineConfig } from "drizzle-kit";

// Only used by `drizzle-kit generate` (it needs no database access).
// Applying migrations goes through `pnpm db:migrate`, which reads the app config.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/index.ts",
  out: "./drizzle",
});
