import { randomUUID } from "node:crypto";
import type {
  GraphDeletionRequestRecord,
  GraphDeletionRequestRepository,
} from "../graph-deletion-request-repository.js";

/** Pending requests only (what the service reads); decided ones are simply dropped. */
export class InMemoryGraphDeletionRequestRepository implements GraphDeletionRequestRepository {
  readonly pending = new Map<string, GraphDeletionRequestRecord>();
  /** Who the users are, for the name the list shows. */
  readonly names = new Map<string, string>();

  create(graphId: string, requestedBy: string): Promise<GraphDeletionRequestRecord | undefined> {
    if (this.pending.has(graphId)) return Promise.resolve(undefined);
    const record: GraphDeletionRequestRecord = {
      id: randomUUID(),
      graphId,
      requestedBy,
      requesterName: this.names.get(requestedBy) ?? "Alguém",
      createdAt: new Date(),
    };
    this.pending.set(graphId, record);
    return Promise.resolve(record);
  }

  findPending(graphId: string): Promise<GraphDeletionRequestRecord | undefined> {
    return Promise.resolve(this.pending.get(graphId));
  }

  listPending(): Promise<GraphDeletionRequestRecord[]> {
    return Promise.resolve([...this.pending.values()]);
  }

  cancel(graphId: string, userId: string): Promise<boolean> {
    const found = this.pending.get(graphId);
    if (!found || found.requestedBy !== userId) return Promise.resolve(false);
    this.pending.delete(graphId);
    return Promise.resolve(true);
  }

  reject(graphId: string): Promise<boolean> {
    return Promise.resolve(this.pending.delete(graphId));
  }
}
