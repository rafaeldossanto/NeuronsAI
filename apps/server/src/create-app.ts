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
    if (route.method === "POST" && route.url === "/memories") {
      route.bodyLimit = 30 * 1024 * 1024;
    } else if (route.method === "POST" && route.url === "/graphs/:id/agent-chats/:agentId/turns") {
      // Room for a base64-encoded 5 MiB image and the text of the message.
      route.bodyLimit = 8 * 1024 * 1024;
    } else {
      route.bodyLimit = 1024 * 1024;
    }
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
