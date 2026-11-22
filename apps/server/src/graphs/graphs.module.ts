import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DrizzleGraphRepository } from "./drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "./drizzle-graph-version.repository.js";
import { GRAPH_REPOSITORY } from "./graph-repository.js";
import { GRAPH_VERSION_REPOSITORY } from "./graph-version-repository.js";
import { GraphVersionService } from "./graph-version.service.js";
import { DrizzleGraphDeletionRequestRepository } from "./drizzle-graph-deletion-request.repository.js";
import { GRAPH_DELETION_REQUEST_REPOSITORY } from "./graph-deletion-request-repository.js";
import { GraphDeletionService } from "./graph-deletion.service.js";
import { GraphService } from "./graph.service.js";
import { GraphsController } from "./graphs.controller.js";

@Module({
  imports: [DatabaseModule],
  controllers: [GraphsController],
  providers: [
    GraphService,
    GraphDeletionService,
    GraphVersionService,
    {
      provide: GRAPH_DELETION_REQUEST_REPOSITORY,
      useClass: DrizzleGraphDeletionRequestRepository,
    },
    { provide: GRAPH_REPOSITORY, useClass: DrizzleGraphRepository },
    { provide: GRAPH_VERSION_REPOSITORY, useClass: DrizzleGraphVersionRepository },
  ],
  exports: [GraphService, GraphVersionService, GRAPH_REPOSITORY, GRAPH_VERSION_REPOSITORY],
})
export class GraphsModule {}
