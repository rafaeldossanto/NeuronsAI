import { Logger } from "@nestjs/common";
import type { FastifyInstance } from "fastify";

/** A request slower than this (ms) is logged. Fixed on purpose: no variable to configure. */
export const SLOW_REQUEST_MS = 1_000;

export interface SlowRequestLogOptions {
  thresholdMs?: number;
  logger?: Pick<Logger, "warn">;
}

/**
 * Logs method, ROUTE PATTERN (`/runs/:id`, never the real URL), status and duration of slow
 * requests. The URL, query string, headers and body are never read, so ids and secrets cannot leak.
 */
export function registerSlowRequestLog(
  instance: FastifyInstance,
  { thresholdMs = SLOW_REQUEST_MS, logger = new Logger("SlowRequest") }: SlowRequestLogOptions = {},
): void {
  instance.addHook("onResponse", (request, reply, done) => {
    const durationMs = Math.round(reply.elapsedTime);
    if (durationMs >= thresholdMs) {
      const route = request.routeOptions.url ?? "(sem rota)";
      logger.warn(`${request.method} ${route} ${reply.statusCode} ${durationMs} ms`);
    }
    done();
  });
}
