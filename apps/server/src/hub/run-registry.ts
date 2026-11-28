import { Injectable } from "@nestjs/common";
import type { GraphDefinition } from "@neurons/graph-schema";
import { RunNotActiveError } from "./hub.errors.js";
import { resourceScope } from "../accounts/resource-scope.js";

export interface ActiveRunContext {
  organizationId: string | null;
  runId: string;
  graph: GraphDefinition;
  /** Spending limit of the whole run; absent means none. */
  budgetUsd?: number;
  /** Who started the run through the API; absent for triggers and the local workspace. */
  startedByUserId?: string;
}

/**
 * The runs this process is currently driving, with the graph each one executes. A run being
 * closed no longer takes messages, but the agents still winding down may report their last usage
 * to it until it is released.
 */
@Injectable()
export class RunRegistry {
  private readonly active = new Map<string, ActiveRunContext>();
  private readonly closing = new Map<string, ActiveRunContext>();

  register(
    runId: string,
    graph: GraphDefinition,
    budgetUsd?: number,
    startedByUserId?: string,
  ): void {
    this.active.set(runId, {
      runId,
      graph,
      organizationId: resourceScope.current().organizationId,
      ...(budgetUsd !== undefined && { budgetUsd }),
      ...(startedByUserId && { startedByUserId }),
    });
  }

  /** The run while it takes messages. */
  find(runId: string): ActiveRunContext | undefined {
    return this.active.get(runId);
  }

  /** @throws RunNotActiveError when the run is not active in this process. */
  require(runId: string): ActiveRunContext {
    const context = this.active.get(runId);
    if (!context) throw new RunNotActiveError(runId);
    return context;
  }

  /** The run while it takes messages or is winding down. */
  findOpen(runId: string): ActiveRunContext | undefined {
    return this.active.get(runId) ?? this.closing.get(runId);
  }

  /** @throws RunNotActiveError when the run is neither active nor winding down. */
  requireOpen(runId: string): ActiveRunContext {
    const context = this.findOpen(runId);
    if (!context) throw new RunNotActiveError(runId);
    return context;
  }

  /** Stops the run from taking messages. Returns whether it was active. */
  close(runId: string): boolean {
    const context = this.active.get(runId);
    if (!context) return false;
    this.active.delete(runId);
    this.closing.set(runId, context);
    return true;
  }

  /** The run is over for good. */
  release(runId: string): void {
    this.active.delete(runId);
    this.closing.delete(runId);
  }
}
