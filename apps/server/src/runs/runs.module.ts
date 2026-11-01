import { Module } from "@nestjs/common";
import { GraphsModule } from "../graphs/graphs.module.js";
import { HubModule } from "../hub/hub.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import { RunService } from "./run.service.js";

@Module({
  imports: [HubModule, RunLogModule, GraphsModule],
  providers: [RunService],
  exports: [RunService],
})
export class RunsModule {}
