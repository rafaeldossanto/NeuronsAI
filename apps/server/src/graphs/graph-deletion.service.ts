import { Inject, Injectable, Logger } from "@nestjs/common";
import { OrganizationAccessError } from "../accounts/account.errors.js";
import { resourceScope } from "../accounts/resource-scope.js";
import {
  GRAPH_DELETION_REQUEST_REPOSITORY,
  type GraphDeletionRequestRecord,
  type GraphDeletionRequestRepository,
} from "./graph-deletion-request-repository.js";
import { GraphService } from "./graph.service.js";
import {
  DeletionRequestAlreadyPendingError,
  DeletionRequestNotFoundError,
  DeletionRequestNotNeededError,
  DeletionRequestNotYoursError,
  DeletionRequestsUnavailableError,
} from "./graphs.errors.js";

const canDelete = (role: string) => role === "owner" || role === "admin";

/**
 * Who deletes a project: an owner or admin directly (the route's permission), a member by asking.
 * The request waits until an owner or admin approves it, which runs the same deletion as the
 * direct one, or rejects it. The caller's role and organization come from the request scope; a
 * graph of another organization is simply "not found".
 */
@Injectable()
export class GraphDeletionService {
  private readonly logger = new Logger(GraphDeletionService.name);

  constructor(
    @Inject(GraphService) private readonly graphs: GraphService,
    @Inject(GRAPH_DELETION_REQUEST_REPOSITORY)
    private readonly requests: GraphDeletionRequestRepository,
  ) {}

  /** The pending requests of the caller's organization, by graph id. */
  async pendingByGraph(): Promise<Map<string, GraphDeletionRequestRecord>> {
    const pending = await this.requests.listPending();
    return new Map(pending.map((request) => [request.graphId, request]));
  }

  /**
   * A member asks for the deletion.
   * @throws GraphNotFoundError, DeletionRequestsUnavailableError, DeletionRequestNotNeededError,
   *   DeletionRequestAlreadyPendingError
   */
  async request(graphId: string): Promise<GraphDeletionRequestRecord> {
    const { userId, role } = resourceScope.current();
    if (!userId || !role) throw new DeletionRequestsUnavailableError();
    if (canDelete(role)) throw new DeletionRequestNotNeededError();
    await this.graphs.get(graphId);
    const created = await this.requests.create(graphId, userId);
    if (!created) throw new DeletionRequestAlreadyPendingError();
    this.logger.log(`Pedido de exclusão aberto: projeto ${graphId}.`);
    return created;
  }

  /**
   * Only who asked withdraws it.
   * @throws GraphNotFoundError, DeletionRequestsUnavailableError, DeletionRequestNotFoundError,
   *   DeletionRequestNotYoursError
   */
  async cancel(graphId: string): Promise<void> {
    const { userId, role } = resourceScope.current();
    if (!userId || !role) throw new DeletionRequestsUnavailableError();
    await this.graphs.get(graphId);
    if (await this.requests.cancel(graphId, userId)) return;
    throw (await this.requests.findPending(graphId))
      ? new DeletionRequestNotYoursError()
      : new DeletionRequestNotFoundError();
  }

  /**
   * Approves: deletes the project like `DELETE /graphs/{id}` does. When the deletion is refused
   * (a run in progress) the request stays pending.
   * @throws GraphNotFoundError, OrganizationAccessError, DeletionRequestNotFoundError,
   *   GraphHasActiveRunsError
   */
  async approve(graphId: string): Promise<void> {
    this.requireDeleter();
    await this.graphs.get(graphId);
    if (!(await this.requests.findPending(graphId))) throw new DeletionRequestNotFoundError();
    await this.graphs.remove(graphId);
    this.logger.log(`Pedido de exclusão aprovado: projeto ${graphId} excluído.`);
  }

  /** @throws GraphNotFoundError, OrganizationAccessError, DeletionRequestNotFoundError */
  async reject(graphId: string): Promise<void> {
    const { userId } = this.requireDeleter();
    await this.graphs.get(graphId);
    if (!(await this.requests.reject(graphId, userId ?? null))) {
      throw new DeletionRequestNotFoundError();
    }
  }

  /** Defense in depth: the route already asks for `delete_graphs`. No role means the local workspace. */
  private requireDeleter() {
    const scope = resourceScope.current();
    if (scope.role && !canDelete(scope.role)) throw new OrganizationAccessError();
    return scope;
  }
}
