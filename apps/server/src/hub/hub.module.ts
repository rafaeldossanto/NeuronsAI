import { Module } from "@nestjs/common";
import { MemoriesModule } from "../memories/memories.module.js";
import { GraphToolsService } from "../memories/graph-tools.service.js";
import { SecretsModule } from "../secrets/secrets.module.js";
import { AgentsModule } from "../agents/agents.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { GuardEnforcer } from "../guards/guard-enforcer.js";
import { guardPolicies } from "../guards/guard-policies.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DrizzleMessageStore } from "./drizzle-message.store.js";
import { HubLifecycle } from "./hub-lifecycle.js";
import { HUB_OPTIONS, Hub } from "./hub.js";
import { MessagePolicyChain } from "./message-policy.js";
import { MESSAGE_STORE, type MessageStore } from "./message-store.js";
import { PermissionPolicy } from "./permission-policy.js";
import { RunRegistry } from "./run-registry.js";
import { Supervisor } from "./supervisor.js";

@Module({
  imports: [
    DatabaseModule,
    RunLogModule,
    AgentsModule,
    RealtimeModule,
    MemoriesModule,
    SecretsModule,
  ],
  providers: [
    RunRegistry,
    GraphToolsService,
    PermissionPolicy,
    // New rules are added to this list, in the order they apply: permission first, then the guards.
    {
      provide: MessagePolicyChain,
      useFactory: (permission: PermissionPolicy, store: MessageStore, config: AppConfig) =>
        new MessagePolicyChain([permission, ...guardPolicies(store, config.guards)]),
      inject: [PermissionPolicy, MESSAGE_STORE, APP_CONFIG],
    },
    { provide: MESSAGE_STORE, useClass: DrizzleMessageStore },
    {
      provide: HUB_OPTIONS,
      useFactory: (config: AppConfig) => ({ askTimeoutMs: config.askTimeoutMs }),
      inject: [APP_CONFIG],
    },
    Hub,
    GuardEnforcer,
    Supervisor,
    HubLifecycle,
  ],
  exports: [Hub, Supervisor, RunRegistry, GuardEnforcer, MESSAGE_STORE],
})
export class HubModule {}
