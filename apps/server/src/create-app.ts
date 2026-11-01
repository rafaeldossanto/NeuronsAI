import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { WsAdapter } from "@nestjs/platform-ws";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./shared/config/app-config.js";
import { AllExceptionsFilter } from "./shared/http/all-exceptions.filter.js";

/** Builds the HTTP + WebSocket application without listening yet. */
export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter(),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  return app;
}
