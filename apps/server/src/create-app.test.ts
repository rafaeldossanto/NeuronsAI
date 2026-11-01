import "reflect-metadata";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app.js";
import { modulesFor } from "./app.module.js";
import { GraphsModule } from "./graphs/graphs.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import type { AppConfig } from "./shared/config/app-config.js";

describe("modulesFor", () => {
  it("brings up the API modules only in api and all modes", () => {
    expect(modulesFor("api")).toEqual(expect.arrayContaining([GraphsModule, RealtimeModule]));
    expect(modulesFor("all")).toEqual(expect.arrayContaining([GraphsModule, RealtimeModule]));
    expect(modulesFor("worker")).not.toContain(GraphsModule);
    expect(modulesFor("worker")).not.toContain(RealtimeModule);
  });
});

describe("application without a database", () => {
  let app: NestFastifyApplication | undefined;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  afterEach(async () => {
    await app?.close();
  });

  async function start(config: AppConfig): Promise<NestFastifyApplication> {
    app = await createApp(config);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  it("boots and reports on /health that the database is not configured", async () => {
    const server = await start({ mode: "all", port: 0, askTimeoutMs: 1000 });

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      database: { status: "not_configured" },
    });
  });

  it("answers unknown routes with { code, message }", async () => {
    const server = await start({ mode: "api", port: 0, askTimeoutMs: 1000 });

    const response = await server.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "route_not_found",
      message: expect.any(String) as string,
    });
  });
});
