import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DrizzleRunnerRepository } from "./drizzle-runner.repository.js";
import { EmbeddedRunner } from "./embedded-runner.js";
import { RUNNER_REPOSITORY } from "./runner-repository.js";
import { RunnerGateway } from "./runner.gateway.js";
import { RunnerRegistry } from "./runner-registry.js";
import { RunnerTokens } from "./runner-tokens.service.js";

/** Where the agents run: the embedded runner (profile `local`) or the ones that connect to /runner. */
@Module({
  imports: [DatabaseModule],
  providers: [
    RunnerRegistry,
    RunnerTokens,
    { provide: RUNNER_REPOSITORY, useClass: DrizzleRunnerRepository },
    EmbeddedRunner,
    RunnerGateway,
  ],
  exports: [RunnerRegistry, RunnerTokens],
})
export class RunnersModule {}
