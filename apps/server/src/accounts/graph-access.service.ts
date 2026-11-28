import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { DatabaseService } from "../database/database.service.js";
import {
  graphAccess,
  graphs,
  graphVersions,
  runs,
  users,
  type GraphAccessMode,
} from "../database/schema/index.js";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import type { GraphRecord } from "../graphs/graph.records.js";
import { RunNotFoundError } from "../run-log/run-log.errors.js";
import { GraphVersionNotFoundError } from "../runs/runs.errors.js";
import {
  UNRESTRICTED_ACCESS,
  canActOnRun,
  canReadDraft,
  canSeeRun,
  resolveGraphAccess,
  type GraphAccessEntryFacts,
  type GraphAccessLevel,
  type GraphAccessSubject,
} from "./graph-access.js";
import { resourceScope, type ResourceScope } from "./resource-scope.js";

/** A person's standing in one project, as the project list shows it. */
export interface GraphAccessSummary {
  level: GraphAccessLevel;
  /** What the person themself asked: waiting (`pending`) or shut out for good (`blocked`). */
  request: "pending" | "blocked" | null;
  /** Requests waiting for a decision; counted only for who decides. */
  pendingRequests: number;
}

export interface GraphAccessView {
  accessMode: GraphAccessMode;
  owner: { id: string; name: string } | null;
  access: GraphAccessSummary;
}

/** Which runs a person reads: every run of `full` projects, and their own in the `own` ones. */
export interface RunVisibility {
  userId: string;
  full: string[];
  own: string[];
}

/** What a route needs from the level; refused levels end as "not found". */
export type GraphAccessCheck = (level: GraphAccessLevel) => boolean;

const sameOrganization = (column: PgColumn, organizationId: string | null): SQL =>
  organizationId === null ? isNull(column) : eq(column, organizationId);

const subjectOf = (user: ResourceScope): GraphAccessSubject | undefined =>
  user.userId && user.role ? { userId: user.userId, role: user.role } : undefined;

const isPrivileged = (subject: GraphAccessSubject) =>
  subject.role === "owner" || subject.role === "admin";

/**
 * The only place that decides what a person may do in a project (see `resolveGraphAccess`); every
 * route that receives a project or a run asks it. A project the person may not see is "not found",
 * so nothing leaks. Without a signed-in person (the account-free workspace) nothing is held back.
 */
@Injectable()
export class GraphAccessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** `none` also for a project that does not exist or belongs to another organization. */
  async effectiveAccess(
    graphId: string,
    user: ResourceScope = resourceScope.current(),
  ): Promise<GraphAccessLevel> {
    const [graph] = await this.database.db
      .select({ ownerUserId: graphs.ownerUserId, accessMode: graphs.accessMode })
      .from(graphs)
      .where(
        and(eq(graphs.id, graphId), sameOrganization(graphs.organizationId, user.organizationId)),
      );
    if (!graph) return "none";
    const subject = subjectOf(user);
    if (!subject) return UNRESTRICTED_ACCESS;
    const entry = isPrivileged(subject) ? undefined : await this.entryOf(graphId, subject.userId);
    return resolveGraphAccess(graph, subject, entry);
  }

  /**
   * @returns the level, when it passes `check`
   * @throws GraphNotFoundError otherwise: a project the person may not use does not exist for them
   */
  async require(
    graphId: string,
    check: GraphAccessCheck,
    user: ResourceScope = resourceScope.current(),
  ): Promise<GraphAccessLevel> {
    const level = await this.effectiveAccess(graphId, user);
    if (!check(level)) throw new GraphNotFoundError(graphId);
    return level;
  }

  /** Same as {@link require} for a route that names a published version. @throws GraphVersionNotFoundError */
  async requireForVersion(
    versionId: string,
    check: GraphAccessCheck,
    user: ResourceScope = resourceScope.current(),
  ): Promise<GraphAccessLevel> {
    const [row] = await this.database.db
      .select({ graphId: graphVersions.graphId })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(
        and(
          eq(graphVersions.id, versionId),
          sameOrganization(graphs.organizationId, user.organizationId),
        ),
      );
    if (!row) throw new GraphVersionNotFoundError(versionId);
    const level = await this.effectiveAccess(row.graphId, user);
    if (!check(level)) throw new GraphVersionNotFoundError(versionId);
    return level;
  }

  /**
   * A run is read by whoever reads the draft, or by the person who started it when they only use
   * the project; it is acted on (stop, talk to the agents, type in its terminals) by whoever edits,
   * or by the person who started it.
   * @throws RunNotFoundError
   */
  async requireRun(
    runId: string,
    action: "read" | "write",
    user: ResourceScope = resourceScope.current(),
  ): Promise<void> {
    const [row] = await this.database.db
      .select({ graphId: graphVersions.graphId, startedByUserId: runs.startedByUserId })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(and(eq(runs.id, runId), sameOrganization(graphs.organizationId, user.organizationId)));
    if (!row) throw new RunNotFoundError(runId);
    const level = await this.effectiveAccess(row.graphId, user);
    const allowed = action === "read" ? canSeeRun : canActOnRun;
    if (!allowed(level, row, user.userId)) throw new RunNotFoundError(runId);
  }

  /**
   * The projects whose runs the person reads, for the run list. Undefined means "all of them" (the
   * account-free workspace, owners and admins), so the list adds no condition.
   */
  async runVisibility(
    user: ResourceScope = resourceScope.current(),
  ): Promise<RunVisibility | undefined> {
    const subject = subjectOf(user);
    if (!subject || isPrivileged(subject)) return undefined;
    const [projects, entries] = await Promise.all([
      this.database.db
        .select({
          id: graphs.id,
          ownerUserId: graphs.ownerUserId,
          accessMode: graphs.accessMode,
        })
        .from(graphs)
        .where(sameOrganization(graphs.organizationId, user.organizationId)),
      this.entriesOf(subject.userId, user.organizationId),
    ]);
    const visibility: RunVisibility = { userId: subject.userId, full: [], own: [] };
    for (const project of projects) {
      const level = resolveGraphAccess(project, subject, entries.get(project.id));
      if (canReadDraft(level)) visibility.full.push(project.id);
      else if (level === "use") visibility.own.push(project.id);
    }
    return visibility;
  }

  /** How each project looks to the person: mode, owner and their access, for the list and the editor. */
  async describe(
    projects: readonly GraphRecord[],
    user: ResourceScope = resourceScope.current(),
  ): Promise<Map<string, GraphAccessView>> {
    const views = new Map<string, GraphAccessView>();
    const subject = subjectOf(user);
    if (!subject) {
      for (const project of projects) {
        views.set(project.id, {
          accessMode: project.accessMode ?? "organization",
          owner: null,
          access: { level: UNRESTRICTED_ACCESS, request: null, pendingRequests: 0 },
        });
      }
      return views;
    }
    const ownerIds = [...new Set(projects.flatMap((p) => (p.ownerUserId ? [p.ownerUserId] : [])))];
    const [entries, owners] = await Promise.all([
      this.entriesOf(subject.userId, user.organizationId),
      ownerIds.length === 0
        ? Promise.resolve<{ id: string; name: string }[]>([])
        : this.database.db
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(inArray(users.id, ownerIds)),
    ]);
    const levels = new Map(
      projects.map((p) => [p.id, resolveGraphAccess(p, subject, entries.get(p.id))] as const),
    );
    const managed = projects.filter((p) => levels.get(p.id) === "manage").map((p) => p.id);
    const pending = await this.pendingCounts(managed);
    const ownerNames = new Map(owners.map((owner) => [owner.id, owner.name]));
    for (const project of projects) {
      const entry = entries.get(project.id);
      views.set(project.id, {
        accessMode: project.accessMode ?? "organization",
        owner:
          project.ownerUserId && ownerNames.has(project.ownerUserId)
            ? { id: project.ownerUserId, name: ownerNames.get(project.ownerUserId)! }
            : null,
        access: {
          level: levels.get(project.id)!,
          request:
            entry?.status === "requested"
              ? "pending"
              : entry?.status === "blocked"
                ? "blocked"
                : null,
          pendingRequests: pending.get(project.id) ?? 0,
        },
      });
    }
    return views;
  }

  private async pendingCounts(graphIds: string[]): Promise<Map<string, number>> {
    if (graphIds.length === 0) return new Map();
    const rows = await this.database.db
      .select({ graphId: graphAccess.graphId, total: count() })
      .from(graphAccess)
      .where(and(inArray(graphAccess.graphId, graphIds), eq(graphAccess.status, "requested")))
      .groupBy(graphAccess.graphId);
    return new Map(rows.map((row) => [row.graphId, Number(row.total)]));
  }

  private async entryOf(
    graphId: string,
    userId: string,
  ): Promise<GraphAccessEntryFacts | undefined> {
    const [entry] = await this.database.db
      .select({ status: graphAccess.status, level: graphAccess.level })
      .from(graphAccess)
      .where(and(eq(graphAccess.graphId, graphId), eq(graphAccess.userId, userId)));
    return entry;
  }

  private async entriesOf(
    userId: string,
    organizationId: string | null,
  ): Promise<Map<string, GraphAccessEntryFacts>> {
    if (organizationId === null) return new Map();
    const rows = await this.database.db
      .select({
        graphId: graphAccess.graphId,
        status: graphAccess.status,
        level: graphAccess.level,
      })
      .from(graphAccess)
      .where(and(eq(graphAccess.userId, userId), eq(graphAccess.organizationId, organizationId)));
    return new Map(rows.map((row) => [row.graphId, { status: row.status, level: row.level }]));
  }
}
