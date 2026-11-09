import { mkdir, readdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DatabaseService,
  type Database,
  type DatabaseTransaction,
} from "../database/database.service.js";
import { organizations } from "../database/schema/accounts.js";
import { graphTriggers, graphVersions, graphs, runs, secrets } from "../database/schema/index.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DomainError } from "../shared/errors/domain-error.js";
import { OrganizationAccessError } from "./account.errors.js";
import { requireOrganizationAccess } from "./organization-access.js";

/** What the local workspace (rows with no organization) holds, as the adoption would move it. */
export interface LocalDataSummary {
  graphs: number;
  versions: number;
  runs: number;
  secrets: number;
  triggers: number;
  memories: number;
}

export class LocalRunsActiveError extends DomainError {
  readonly kind = "conflict" as const;
  constructor() {
    super(
      "local_runs_active",
      "Há execuções locais em andamento. Espere terminarem ou pare-as antes de mover os dados.",
    );
  }
}

export class LocalSecretsConflictError extends DomainError {
  readonly kind = "conflict" as const;
  constructor(names: string[]) {
    super(
      "local_secrets_conflict",
      `A organização já tem segredos com estes nomes: ${names.join(", ")}. Renomeie um dos lados e tente de novo.`,
    );
  }
}

export class LocalSecretsUnreadableError extends DomainError {
  readonly kind = "unavailable" as const;
  constructor() {
    super(
      "local_secrets_unreadable",
      "Não foi possível ler os segredos locais com a chave mestra deste servidor. Nada foi movido.",
    );
  }
}

/**
 * The one explicit way to bring the account-free local workspace (everything with
 * `organization_id` NULL) into an organization, once a server has accounts. Never automatic:
 * only an owner of the organization calls it, after a confirmation.
 *
 * The database part is a single transaction: it either moves everything or nothing. Graphs carry
 * their versions, runs and triggers with them (those are reached through the graph). Secrets are
 * re-encrypted, because their organization is part of what the cipher authenticates. Memories are
 * folders on disk, moved afterwards and one by one; a second call finishes whatever a crash left,
 * and with nothing left to move it does nothing (idempotent). Runners stay where they are:
 * they are machines, not workspace content.
 */
@Injectable()
export class LocalDataAdoption {
  private readonly cipher?: AesGcmSecretCipher;
  private readonly memoriesRoot: string;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.memoriesRoot = path.join(config.dataDir, "memories");
    if (config.masterKey) this.cipher = new AesGcmSecretCipher(config.masterKey);
  }

  /** @throws OrganizationAccessError unless `userId` is an owner of the organization. */
  async summary(userId: string, organizationId: string): Promise<LocalDataSummary> {
    await this.requireDestination(organizationId);
    await requireOwner(this.database.db, userId, organizationId);
    return this.summarize(this.database.db);
  }

  /**
   * Moves the local workspace into the organization; returns what was moved.
   * @throws OrganizationAccessError, LocalRunsActiveError, LocalSecretsConflictError
   */
  async adopt(userId: string, organizationId: string): Promise<LocalDataSummary> {
    await this.requireDestination(organizationId);
    await requireOwner(this.database.db, userId, organizationId);
    const binding = path.join(this.config.dataDir, "local-data-adoption.json");
    await mkdir(this.config.dataDir, { recursive: true });
    await writeFile(binding, JSON.stringify({ organizationId }), { flag: "wx", mode: 0o600 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    await this.requireDestination(organizationId);
    const moved = await this.database.db.transaction(async (tx) => {
      // There is one local workspace and many organizations that could claim it: two adoptions at
      // once (into different organizations) would each read the same local rows, and the second
      // would then re-point secrets the first had just moved. One adoption at a time, whichever the
      // organization; the lock is released with the transaction.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('neurons:adopt-local-data'))`);
      // Serialises an adoption with member changes on the same organization.
      await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update");
      await requireOwner(tx, userId, organizationId);

      const [active] = await tx
        .select({ total: count() })
        .from(runs)
        .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
        .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
        .where(and(isNull(graphs.organizationId), inArray(runs.status, ["pending", "running"])));
      if (active && active.total > 0) throw new LocalRunsActiveError();

      const summary = await this.summarize(tx);
      await this.moveSecrets(tx, organizationId);
      // Triggers arrive switched off, webhooks as well as schedules: a schedule armed in memory
      // cannot fire from the local scope once the graph has left it, and a webhook that answered
      // for the local workspace must not start answering for an organization without its owner
      // saying so. The owner turns them on again in the organization.
      const localGraphs = tx
        .select({ id: graphs.id })
        .from(graphs)
        .where(isNull(graphs.organizationId));
      await tx
        .update(graphTriggers)
        .set({ enabled: false, nextRunAt: null })
        .where(inArray(graphTriggers.graphId, localGraphs));
      await tx.update(graphs).set({ organizationId }).where(isNull(graphs.organizationId));
      return summary;
    });
    // Outside the transaction on purpose: files cannot roll back. The rows are already in the
    // organization, so a failure here leaves memories that the next call moves.
    const memories = await this.moveMemories(organizationId);
    return { ...moved, memories };
  }

  private async requireDestination(organizationId: string): Promise<void> {
    if (this.config.localDataOrganizationId !== organizationId) throw new OrganizationAccessError();
    try {
      const binding = JSON.parse(
        await readFile(path.join(this.config.dataDir, "local-data-adoption.json"), "utf8"),
      ) as { organizationId?: string };
      if (binding.organizationId !== organizationId) throw new OrganizationAccessError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async summarize(db: Database | DatabaseTransaction): Promise<LocalDataSummary> {
    const local = isNull(graphs.organizationId);
    const [[g], [v], [r], [s], [t]] = await Promise.all([
      db.select({ total: count() }).from(graphs).where(local),
      db
        .select({ total: count() })
        .from(graphVersions)
        .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
        .where(local),
      db
        .select({ total: count() })
        .from(runs)
        .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
        .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
        .where(local),
      db.select({ total: count() }).from(secrets).where(isNull(secrets.organizationId)),
      db
        .select({ total: count() })
        .from(graphTriggers)
        .innerJoin(graphs, eq(graphs.id, graphTriggers.graphId))
        .where(local),
    ]);
    return {
      graphs: g?.total ?? 0,
      versions: v?.total ?? 0,
      runs: r?.total ?? 0,
      secrets: s?.total ?? 0,
      triggers: t?.total ?? 0,
      memories: (await this.localMemoryIds()).length,
    };
  }

  private async moveSecrets(tx: DatabaseTransaction, organizationId: string): Promise<void> {
    const local = await tx.select().from(secrets).where(isNull(secrets.organizationId));
    if (local.length === 0) return;
    const existing = await tx
      .select({ name: secrets.name })
      .from(secrets)
      .where(eq(secrets.organizationId, organizationId));
    const taken = new Set(existing.map((row) => row.name));
    const clashes = local.filter((row) => taken.has(row.name)).map((row) => row.name);
    if (clashes.length > 0) throw new LocalSecretsConflictError(clashes.sort());
    // The organization is part of what the cipher authenticates: re-encrypt, never copy bytes.
    for (const row of local) {
      let next;
      try {
        if (!this.cipher) throw new LocalSecretsUnreadableError();
        const plain = this.cipher.decrypt(row, row.name);
        next = this.cipher.encrypt(plain, `organization:${organizationId}:${row.name}`);
      } catch {
        throw new LocalSecretsUnreadableError();
      }
      await tx
        .update(secrets)
        .set({ organizationId, ...next, updatedAt: sql`now()` })
        .where(and(eq(secrets.id, row.id), isNull(secrets.organizationId)));
    }
  }

  private async localMemoryIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.memoriesRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && z.uuid().safeParse(entry.name).success)
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /** Moves each memory folder; one already in the destination is left alone (never overwritten). */
  private async moveMemories(organizationId: string): Promise<number> {
    const ids = await this.localMemoryIds();
    if (ids.length === 0) return 0;
    const target = path.join(this.memoriesRoot, "organizations", organizationId);
    await mkdir(target, { recursive: true });
    let moved = 0;
    for (const id of ids) {
      const destination = path.join(target, id);
      if (await exists(destination)) continue;
      await rename(path.join(this.memoriesRoot, id), destination);
      moved++;
    }
    return moved;
  }
}

async function requireOwner(
  db: Database | DatabaseTransaction,
  userId: string,
  organizationId: string,
): Promise<void> {
  const access = await requireOrganizationAccess(db, userId, organizationId, "manage_members");
  if (access.role !== "owner") throw new OrganizationAccessError();
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
