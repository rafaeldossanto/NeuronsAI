import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import {
  graphAccess,
  graphs,
  memberships,
  users,
  type GraphAccessMode,
  type GraphAccessStatus,
  type GraphGrantLevel,
} from "../database/schema/index.js";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import {
  GraphAccessAlreadyGrantedError,
  GraphAccessBlockedError,
  GraphAccessEntryNotFoundError,
  GraphAccessMemberNotFoundError,
  GraphAccessProtectedError,
  GraphAccessRequestNotFoundError,
  GraphAccessRequestPendingError,
  GraphAccessUnavailableError,
} from "./graph-access.errors.js";
import { canManageGraph } from "./graph-access.js";
import { GraphAccessService } from "./graph-access.service.js";
import { resourceScope } from "./resource-scope.js";

export interface GraphAccessEntryRecord {
  user: { id: string; name: string; email: string | null };
  status: GraphAccessStatus;
  level: GraphGrantLevel | null;
  requestedAt: Date | null;
  decidedAt: Date | null;
}

export interface GraphAccessDetails {
  mode: GraphAccessMode;
  owner: { id: string; name: string } | null;
  entries: GraphAccessEntryRecord[];
}

interface ManagedGraph {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  accessMode: GraphAccessMode;
}

/**
 * Who gets into a project, decided by whoever manages it (the project's owner, and owners and
 * admins of the organization), and the asking side: a person without access asks, the manager
 * approves choosing the level, or refuses (the request is erased and the person may ask again) or
 * blocks (which stops new requests). Who may not manage sees every route here as "not found".
 */
@Injectable()
export class GraphAccessAdminService {
  private readonly logger = new Logger(GraphAccessAdminService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(GraphAccessService) private readonly access: GraphAccessService,
  ) {}

  /** @throws GraphNotFoundError for who does not manage the project (and in the local workspace) */
  async details(graphId: string): Promise<GraphAccessDetails> {
    const { graph } = await this.requireManager(graphId);
    const [entries, owner] = await Promise.all([
      this.database.db
        .select({
          id: users.id,
          name: users.displayName,
          email: users.email,
          status: graphAccess.status,
          level: graphAccess.level,
          requestedAt: graphAccess.requestedAt,
          decidedAt: graphAccess.decidedAt,
        })
        .from(graphAccess)
        .innerJoin(users, eq(users.id, graphAccess.userId))
        .where(eq(graphAccess.graphId, graphId))
        .orderBy(asc(graphAccess.createdAt), asc(graphAccess.id)),
      graph.ownerUserId
        ? this.database.db
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(eq(users.id, graph.ownerUserId))
        : Promise.resolve<{ id: string; name: string }[]>([]),
    ]);
    return {
      mode: graph.accessMode,
      owner: owner[0] ?? null,
      entries: entries.map((row) => ({
        user: { id: row.id, name: row.name, email: row.email },
        status: row.status,
        level: row.level,
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
      })),
    };
  }

  /** @throws GraphNotFoundError */
  async setMode(graphId: string, mode: GraphAccessMode): Promise<void> {
    await this.requireManager(graphId);
    await this.database.db.update(graphs).set({ accessMode: mode }).where(eq(graphs.id, graphId));
    this.logger.log(`Acesso do projeto ${graphId} agora é "${mode}".`);
  }

  /**
   * Lets the person in at `level`, which also approves their request.
   * @throws GraphNotFoundError, GraphAccessMemberNotFoundError, GraphAccessProtectedError
   */
  async grant(graphId: string, targetUserId: string, level: GraphGrantLevel): Promise<void> {
    await this.decide(graphId, targetUserId, "granted", level);
  }

  /** @throws GraphNotFoundError, GraphAccessMemberNotFoundError, GraphAccessProtectedError */
  async block(graphId: string, targetUserId: string): Promise<void> {
    await this.decide(graphId, targetUserId, "blocked", null);
  }

  /**
   * Takes back a release or a block, or refuses a request: the row goes away, so the person is
   * back to what the mode gives them and, unless blocked, may ask again.
   * @throws GraphNotFoundError, GraphAccessEntryNotFoundError
   */
  async remove(graphId: string, targetUserId: string): Promise<void> {
    await this.requireManager(graphId);
    const removed = await this.database.db
      .delete(graphAccess)
      .where(and(eq(graphAccess.graphId, graphId), eq(graphAccess.userId, targetUserId)))
      .returning({ id: graphAccess.id });
    if (removed.length === 0) throw new GraphAccessEntryNotFoundError();
  }

  /**
   * The caller, who cannot open the project, asks to get in.
   * @throws GraphAccessUnavailableError, GraphNotFoundError, GraphAccessAlreadyGrantedError,
   *   GraphAccessBlockedError, GraphAccessRequestPendingError
   */
  async request(graphId: string): Promise<{ requestedAt: Date }> {
    const { userId } = this.requireAccounts();
    const graph = await this.requireGraph(graphId);
    if ((await this.access.effectiveAccess(graphId)) !== "none") {
      throw new GraphAccessAlreadyGrantedError();
    }
    const [entry] = await this.database.db
      .select({ status: graphAccess.status })
      .from(graphAccess)
      .where(and(eq(graphAccess.graphId, graphId), eq(graphAccess.userId, userId)));
    if (entry?.status === "blocked") throw new GraphAccessBlockedError();
    if (entry) throw new GraphAccessRequestPendingError();
    const requestedAt = new Date();
    const [inserted] = await this.database.db
      .insert(graphAccess)
      .values({
        graphId,
        organizationId: graph.organizationId,
        userId,
        status: "requested",
        requestedAt,
      })
      .onConflictDoNothing()
      .returning({ id: graphAccess.id });
    if (!inserted) throw new GraphAccessRequestPendingError();
    this.logger.log(`Pedido de acesso aberto: projeto ${graphId}.`);
    return { requestedAt };
  }

  /** @throws GraphAccessUnavailableError, GraphNotFoundError, GraphAccessRequestNotFoundError */
  async cancelRequest(graphId: string): Promise<void> {
    const { userId } = this.requireAccounts();
    await this.requireGraph(graphId);
    const cancelled = await this.database.db
      .delete(graphAccess)
      .where(
        and(
          eq(graphAccess.graphId, graphId),
          eq(graphAccess.userId, userId),
          eq(graphAccess.status, "requested"),
        ),
      )
      .returning({ id: graphAccess.id });
    if (cancelled.length === 0) throw new GraphAccessRequestNotFoundError();
  }

  private async decide(
    graphId: string,
    targetUserId: string,
    status: "granted" | "blocked",
    level: GraphGrantLevel | null,
  ): Promise<void> {
    const { graph, userId } = await this.requireManager(graphId);
    const [member] = await this.database.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, graph.organizationId),
          eq(memberships.userId, targetUserId),
        ),
      );
    if (!member) throw new GraphAccessMemberNotFoundError();
    if (member.role === "owner" || member.role === "admin" || graph.ownerUserId === targetUserId) {
      throw new GraphAccessProtectedError();
    }
    const decision = { status, level, decidedBy: userId, decidedAt: new Date() };
    await this.database.db
      .insert(graphAccess)
      .values({ graphId, organizationId: graph.organizationId, userId: targetUserId, ...decision })
      .onConflictDoUpdate({ target: [graphAccess.graphId, graphAccess.userId], set: decision });
  }

  /** Accounts only: without a signed-in person there is no one to ask or to decide. */
  private requireAccounts(): { userId: string } {
    const { userId, role, organizationId } = resourceScope.current();
    if (!userId || !role || organizationId === null) throw new GraphAccessUnavailableError();
    return { userId };
  }

  private async requireGraph(graphId: string): Promise<ManagedGraph> {
    const organizationId = resourceScope.current().organizationId;
    if (organizationId === null) throw new GraphNotFoundError(graphId);
    const [graph] = await this.database.db
      .select({
        id: graphs.id,
        organizationId: graphs.organizationId,
        ownerUserId: graphs.ownerUserId,
        accessMode: graphs.accessMode,
      })
      .from(graphs)
      .where(and(eq(graphs.id, graphId), eq(graphs.organizationId, organizationId)));
    if (!graph) throw new GraphNotFoundError(graphId);
    return { ...graph, organizationId };
  }

  private async requireManager(graphId: string): Promise<{ graph: ManagedGraph; userId: string }> {
    const { userId, role } = resourceScope.current();
    // In the local workspace nobody manages access: the routes do not exist for it.
    if (!userId || !role) throw new GraphNotFoundError(graphId);
    await this.access.require(graphId, canManageGraph);
    return { graph: await this.requireGraph(graphId), userId };
  }
}
