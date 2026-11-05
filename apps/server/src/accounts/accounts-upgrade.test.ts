import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../database/migrations-folder.js";
import { PgliteDatabaseProvider } from "../database/pglite-database.provider.js";
import { graphs, graphVersions, runEvents, runs, secrets } from "../database/schema/index.js";

it("T25a acrescenta as contas a uma base T17 sem mudar projetos, versões, execuções ou segredos", async () => {
  const provider = await PgliteDatabaseProvider.open();
  const db = provider.db;
  try {
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    const foundationIndex = 6;
    for (const migration of migrations.slice(0, foundationIndex)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    const draft = { name: "Projeto local", nodes: [], links: [], annotations: [] };
    const [graph] = await db.insert(graphs).values({ name: "Projeto local", draft }).returning();
    const [version] = await db
      .insert(graphVersions)
      .values({
        graphId: graph!.id,
        version: 1,
        definition: { ...draft, schemaVersion: 1, id: graph!.id },
      })
      .returning();
    const [run] = await db.insert(runs).values({ graphVersionId: version!.id }).returning();
    await db.insert(runEvents).values({ runId: run!.id, seq: 1, type: "RunStarted", payload: {} });
    await db.insert(secrets).values({
      name: "teste",
      ciphertext: Buffer.from("conteúdo cifrado de teste"),
      iv: Buffer.alloc(12),
      authTag: Buffer.alloc(16),
    });
    const before = {
      graphs: await db.select().from(graphs),
      versions: await db.select().from(graphVersions),
      runs: await db.select().from(runs),
      events: await db.select().from(runEvents),
      secrets: await db.select().from(secrets),
    };
    for (const statement of migrations[foundationIndex]!.sql) await db.execute(sql.raw(statement));
    expect({
      graphs: await db.select().from(graphs),
      versions: await db.select().from(graphVersions),
      runs: await db.select().from(runs),
      events: await db.select().from(runEvents),
      secrets: await db.select().from(secrets),
    }).toEqual(before);
    await expect(db.select().from(graphs)).resolves.toHaveLength(1);
  } finally {
    await provider.close();
  }
}, 60_000);
