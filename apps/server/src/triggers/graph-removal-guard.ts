import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { GraphService } from "../graphs/graph.service.js";
import { TriggersService } from "./triggers.service.js";

/** Before a graph is deleted its triggers are turned off, so no schedule or webhook fires into it. */
@Injectable()
export class GraphRemovalGuard implements OnModuleInit {
  constructor(
    @Inject(GraphService) private readonly graphs: GraphService,
    @Inject(TriggersService) private readonly triggers: TriggersService,
  ) {}

  onModuleInit(): void {
    this.graphs.onBeforeRemove((graphId) => this.triggers.disableAllOf(graphId));
  }
}
