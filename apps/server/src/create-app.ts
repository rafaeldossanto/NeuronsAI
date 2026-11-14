import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./shared/config/app-config.js";
import { configureApp } from "./configure-app.js";
import { registerSlowRequestLog } from "./slow-request-log.js";
import { registerUiRoutes, rewriteForUi, type UiOptions } from "./ui/serve-ui.js";

export interface CreateAppOptions {
  /**
   * Also serve the built interface from this server: it answers at `/`, and the API moves under
   * `/api` (the WebSocket stays at `/ws`). Without it the API is at the root, as always.
   */
  ui?: UiOptions;
}

/** Builds the HTTP + WebSocket application without listening yet. */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    forceCloseConnections: true,
    bodyLimit: 30 * 1024 * 1024,
    ...(options.ui ? { rewriteUrl: (req: { url?: string }) => rewriteForUi(req.url ?? "/") } : {}),
  });
  registerSlowRequestLog(adapter.getInstance());
  adapter.getInstance().addHook("onRoute", (route) => {
    route.bodyLimit =
      route.method === "POST" && route.url === "/memories" ? 30 * 1024 * 1024 : 1024 * 1024;
  });
  // abortOnError: false makes a failure while booting (a data folder in use, say) reject instead of
  // exiting the process, so whoever embeds the server (the desktop app) can show it to the user.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    adapter,
    {
      abortOnError: false,
    },
  );
  configureApp(app, config);
  if (options.ui) registerUiRoutes(adapter.getInstance(), options.ui);
  return app;
}
