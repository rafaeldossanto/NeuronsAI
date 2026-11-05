import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../database/migrations-folder.js";
import { PgliteDatabaseProvider } from "../database/pglite-database.provider.js";
import { graphs, graphVersions, runEvents, runs, secrets } from "../database/schema/index.js";
import { rowsOf } from "../database/testing/test-database.js";

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
    const [graph] = rowsOf<{ id: string }>(
      await db.execute(
        sql`insert into graphs (name, draft) values ('Projeto local', ${JSON.stringify(draft)}::jsonb) returning id`,
      ),
    );
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
    await db.execute(
      sql`insert into secrets (name, ciphertext, iv, auth_tag) values ('teste', decode('abcd', 'hex'), decode('abcd', 'hex'), decode('abcd', 'hex'))`,
    );
    const oldGraphs = {
      id: graphs.id,
      name: graphs.name,
      draft: graphs.draft,
      createdAt: graphs.createdAt,
      updatedAt: graphs.updatedAt,
    };
    const oldSecrets = {
      name: secrets.name,
      ciphertext: secrets.ciphertext,
      iv: secrets.iv,
      authTag: secrets.authTag,
      createdAt: secrets.createdAt,
      updatedAt: secrets.updatedAt,
    };
    const before = {
      graphs: await db.select(oldGraphs).from(graphs),
      versions: await db.select().from(graphVersions),
      runs: await db.select().from(runs),
      events: await db.select().from(runEvents),
      secrets: await db.select(oldSecrets).from(secrets),
    };
    for (const migration of migrations.slice(foundationIndex)) {
      for (const statement of migration.sql) await db.execute(sql.raw(statement));
    }
    expect({
      graphs: await db.select(oldGraphs).from(graphs),
      versions: await db.select().from(graphVersions),
      runs: await db.select().from(runs),
      events: await db.select().from(runEvents),
      secrets: await db.select(oldSecrets).from(secrets),
    }).toEqual(before);
    await expect(db.select().from(graphs)).resolves.toHaveLength(1);
  } finally {
    await provider.close();
  }
}, 60_000);
