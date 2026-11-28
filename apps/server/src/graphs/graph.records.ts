import type { GraphDefinition } from "@neurons/graph-schema";
import type { GraphAccessMode } from "../database/schema/index.js";

export interface GraphRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /** Who created it through a signed-in session; absent or null for the local workspace and older projects. */
  ownerUserId?: string | null;
  /** Absent means `organization`: every member has the access of their role. */
  accessMode?: GraphAccessMode;
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
