import { Injectable } from "@nestjs/common";
import type { GraphDefinition } from "@neurons/graph-schema";
import { RunNotActiveError } from "./hub.errors.js";

export interface ActiveRunContext {
  runId: string;
  graph: GraphDefinition;
}

/** The runs this process is currently driving, with the graph each one executes. */
@Injectable()
export class RunRegistry {
  private readonly runs = new Map<string, ActiveRunContext>();

  register(runId: string, graph: GraphDefinition): void {
    this.runs.set(runId, { runId, graph });
  }

  find(runId: string): ActiveRunContext | undefined {
    return this.runs.get(runId);
  }

  /** @throws RunNotActiveError when the run is not active in this process. */
  require(runId: string): ActiveRunContext {
    const context = this.runs.get(runId);
    if (!context) throw new RunNotActiveError(runId);
    return context;
  }

  /** Returns whether the run was registered. */
  remove(runId: string): boolean {
    return this.runs.delete(runId);
  }
}
