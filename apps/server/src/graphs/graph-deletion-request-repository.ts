/** A pending request to delete a graph, with the name of who asked (the list shows it). */
export interface GraphDeletionRequestRecord {
  id: string;
  graphId: string;
  requestedBy: string;
  requesterName: string;
  createdAt: Date;
}

export interface GraphDeletionRequestRepository {
  /** Opens a pending request; undefined when the graph already has one. */
  create(graphId: string, requestedBy: string): Promise<GraphDeletionRequestRecord | undefined>;
  findPending(graphId: string): Promise<GraphDeletionRequestRecord | undefined>;
  /** The pending requests of the caller's organization, by graph. */
  listPending(): Promise<GraphDeletionRequestRecord[]>;
  /** Withdraws the pending request, only when `userId` is who asked. Returns whether it did. */
  cancel(graphId: string, userId: string): Promise<boolean>;
  /** Rejects the pending request. `decidedBy` is null in the account-free workspace. */
  reject(graphId: string, decidedBy: string | null): Promise<boolean>;
}

export const GRAPH_DELETION_REQUEST_REPOSITORY = Symbol("GRAPH_DELETION_REQUEST_REPOSITORY");
