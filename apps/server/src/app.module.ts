import { type DynamicModule, type Type, Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { GraphsModule } from "./graphs/graphs.module.js";
import { HealthModule } from "./health/health.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { RunsModule } from "./runs/runs.module.js";
import { SecretsModule } from "./secrets/secrets.module.js";
import type { AppConfig, AppMode } from "./shared/config/app-config.js";
import { ConfigModule } from "./shared/config/config.module.js";

/** Needed by every mode. */
const COMMON_MODULES: Type[] = [DatabaseModule, SecretsModule, HealthModule];

/** Which feature modules each mode brings up; the worker side runs the Hub and the agent runtimes. */
const MODULES_BY_MODE: Record<Exclude<AppMode, "all">, Type[]> = {
  api: [GraphsModule, RealtimeModule],
  worker: [RunsModule],
};

export function modulesFor(mode: AppMode): Type[] {
  const modes = mode === "all" ? (["api", "worker"] as const) : ([mode] as const);
  return [...COMMON_MODULES, ...modes.flatMap((name) => MODULES_BY_MODE[name])];
}

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), ...modulesFor(config.mode)],
    };
  }
}
