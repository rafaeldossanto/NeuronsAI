import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DrizzleGraphRepository } from "./drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "./drizzle-graph-version.repository.js";
import { GRAPH_REPOSITORY } from "./graph-repository.js";
import { GRAPH_VERSION_REPOSITORY } from "./graph-version-repository.js";
import { GraphVersionService } from "./graph-version.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    GraphVersionService,
    { provide: GRAPH_REPOSITORY, useClass: DrizzleGraphRepository },
    { provide: GRAPH_VERSION_REPOSITORY, useClass: DrizzleGraphVersionRepository },
  ],
  exports: [GraphVersionService, GRAPH_REPOSITORY, GRAPH_VERSION_REPOSITORY],
})
export class GraphsModule {}
