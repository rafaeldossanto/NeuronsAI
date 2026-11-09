import { randomUUID } from "node:crypto";
import type { GraphDefinition } from "@neurons/graph-schema";
import type { GraphChanges, GraphRepository } from "../graph-repository.js";
import type { GraphVersionRepository } from "../graph-version-repository.js";
import type { GraphRecord, GraphVersionRecord } from "../graph.records.js";

export class InMemoryGraphRepository implements GraphRepository {
  private readonly records = new Map<string, GraphRecord>();

  create(input: { name: string; draft?: unknown }): Promise<GraphRecord> {
    const now = new Date();
    const record: GraphRecord = {
      id: randomUUID(),
      name: input.name,
      draft: input.draft ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  findById(id: string): Promise<GraphRecord | undefined> {
    return Promise.resolve(this.records.get(id));
  }

  list(): Promise<GraphRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  update(id: string, changes: GraphChanges): Promise<GraphRecord | undefined> {
    const record = this.records.get(id);
    if (!record) return Promise.resolve(undefined);
    const updated = {
      ...record,
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.draft !== undefined && { draft: changes.draft }),
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    return Promise.resolve(updated);
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.records.delete(id));
  }
}

export class InMemoryGraphVersionRepository implements GraphVersionRepository {
  private readonly records: GraphVersionRecord[] = [];

  appendNext(
    graphId: string,
    definition: GraphDefinition,
    credentialsApproved = false,
  ): Promise<GraphVersionRecord> {
    const record: GraphVersionRecord = {
      id: randomUUID(),
      graphId,
      version: this.versionsOf(graphId).length + 1,
      definition,
      credentialsApproved,
      createdAt: new Date(),
    };
    this.records.push(record);
    return Promise.resolve(record);
  }

  findById(versionId: string): Promise<GraphVersionRecord | undefined> {
    return Promise.resolve(this.records.find((record) => record.id === versionId));
  }

  findLatest(graphId: string): Promise<GraphVersionRecord | undefined> {
    return Promise.resolve(this.versionsOf(graphId).at(-1));
  }

  findByVersion(graphId: string, version: number): Promise<GraphVersionRecord | undefined> {
    return Promise.resolve(this.versionsOf(graphId).find((record) => record.version === version));
  }

  listByGraph(graphId: string): Promise<GraphVersionRecord[]> {
    return Promise.resolve(this.versionsOf(graphId));
  }

  private versionsOf(graphId: string): GraphVersionRecord[] {
    return this.records.filter((record) => record.graphId === graphId);
  }
}
