import type { INestApplication } from "@nestjs/common";
import { WsAdapter } from "@nestjs/platform-ws";
import { z } from "zod";
import { ResponseContractInterceptor } from "./api/response-contract.interceptor.js";
import { AllExceptionsFilter } from "./shared/http/all-exceptions.filter.js";
import type { AppConfig } from "./shared/config/app-config.js";
import { allowsLocalRequest } from "./shared/http/local-request-policy.js";

/** What every way of running the app (the server, the tests, the demo) sets up the same. */
export function configureApp(app: INestApplication, config?: AppConfig): void {
  if (config && !config.auth) {
    const fastify = app.getHttpAdapter().getInstance() as import("fastify").FastifyInstance;
    fastify.addHook("onRequest", async (request, reply) => {
      if (!allowsLocalRequest(request.raw, config))
        return reply.code(403).send({ code: "origin_forbidden" });
    });
    const server = app.getHttpServer() as import("node:http").Server;
    server.prependListener("upgrade", (request, socket) => {
      if (!allowsLocalRequest(request, config)) socket.destroy();
    });
  }
  // Validation messages are for the user: they come out in Portuguese.
  z.config(z.locales.pt());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseContractInterceptor());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
}
