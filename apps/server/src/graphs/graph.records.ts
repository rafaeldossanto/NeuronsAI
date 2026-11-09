import type { GraphDefinition } from "@neurons/graph-schema";

export interface GraphRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /** Work in progress; may not be a valid graph yet. */
  draft: unknown;
}

export interface GraphVersionRecord {
  id: string;
  graphId: string;
  version: number;
  definition: GraphDefinition;
  credentialsApproved?: boolean;
  createdAt: Date;
}
