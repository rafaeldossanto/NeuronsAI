import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PgliteDatabaseProvider } from "./pglite-database.provider.js";
import { graphs } from "./schema/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "neurons-pglite-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("PgliteDatabaseProvider", () => {
  it("creates the data folder and keeps the data after being closed and opened again", async () => {
    const dataDir = path.join(root, "nested", "db");
    const first = await PgliteDatabaseProvider.open(dataDir);
    expect(first.description).toContain(dataDir);
    await first.migrate();
    await first.db.insert(graphs).values({ name: "Persistente" });
    await first.close();
    await expect(first.close()).resolves.toBeUndefined();

    const second = await PgliteDatabaseProvider.open(dataDir);
    try {
      await second.migrate();
      const rows = await second.db.select().from(graphs);
      expect(rows.map((row) => row.name)).toEqual(["Persistente"]);
    } finally {
      await second.close();
    }
  });
});
