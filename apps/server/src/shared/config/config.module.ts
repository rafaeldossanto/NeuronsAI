import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { AppConfig } from "./app-config.js";
import { APP_CONFIG } from "./tokens.js";

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
