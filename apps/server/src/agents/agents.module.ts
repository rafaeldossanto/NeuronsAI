import { Module } from "@nestjs/common";
import { AGENT_RUNTIME_FACTORY, UnavailableAgentRuntimeFactory } from "./agent-runtime-factory.js";

/** Where the real runtime factory plugs in (T07/T08 replace the placeholder). */
@Module({
  providers: [{ provide: AGENT_RUNTIME_FACTORY, useClass: UnavailableAgentRuntimeFactory }],
  exports: [AGENT_RUNTIME_FACTORY],
})
export class AgentsModule {}
