import type { INestApplication } from "@nestjs/common";
import { WsAdapter } from "@nestjs/platform-ws";
import { z } from "zod";
import { ResponseContractInterceptor } from "./api/response-contract.interceptor.js";
import { AllExceptionsFilter } from "./shared/http/all-exceptions.filter.js";

/** What every way of running the app (the server, the tests, the demo) sets up the same. */
export function configureApp(app: INestApplication): void {
  // Validation messages are for the user: they come out in Portuguese.
  z.config(z.locales.pt());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseContractInterceptor());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
}
