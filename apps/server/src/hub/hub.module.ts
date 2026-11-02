import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DrizzleMessageStore } from "./drizzle-message.store.js";
import { HubLifecycle } from "./hub-lifecycle.js";
import { HUB_OPTIONS, Hub } from "./hub.js";
import { MessagePolicyChain } from "./message-policy.js";
import { MESSAGE_STORE } from "./message-store.js";
import { PermissionPolicy } from "./permission-policy.js";
import { RunRegistry } from "./run-registry.js";
import { Supervisor } from "./supervisor.js";

@Module({
  imports: [DatabaseModule, RunLogModule, AgentsModule, RealtimeModule],
  providers: [
    RunRegistry,
    PermissionPolicy,
    // New rules (limits, anti ping-pong...) are added to this list, in the order they apply.
    {
      provide: MessagePolicyChain,
      useFactory: (permission: PermissionPolicy) => new MessagePolicyChain([permission]),
      inject: [PermissionPolicy],
    },
    { provide: MESSAGE_STORE, useClass: DrizzleMessageStore },
    {
      provide: HUB_OPTIONS,
      useFactory: (config: AppConfig) => ({ askTimeoutMs: config.askTimeoutMs }),
      inject: [APP_CONFIG],
    },
    Hub,
    Supervisor,
    HubLifecycle,
  ],
  exports: [Hub, Supervisor, RunRegistry],
})
export class HubModule {}
