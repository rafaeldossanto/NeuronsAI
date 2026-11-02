import "reflect-metadata";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./create-app.js";
import { graphs } from "./database/schema/index.js";
import { DatabaseService } from "./database/database.service.js";
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

/** Postgres chosen but no connection variables: the process still boots. */
const baseConfig = {
  host: "127.0.0.1",
  port: 0,
  guards: { runMaxMessages: 200, pingPongMessages: 20 },
  usageFlushMs: 0,
  askTimeoutMs: 1000,
  dataDir: "unused",
  database: { kind: "postgres" },
} satisfies Omit<AppConfig, "mode">;

let app: NestFastifyApplication | undefined;

beforeAll(() => {
  Logger.overrideLogger(false);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(config: AppConfig): Promise<NestFastifyApplication> {
  app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("application without a database", () => {
  it("boots and reports on /health that the database is not configured", async () => {
    const server = await start({ ...baseConfig, mode: "all" });

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      database: { type: "postgres", status: "not_configured" },
    });
  });

  it("answers unknown routes with { code, message }", async () => {
    const server = await start({ ...baseConfig, mode: "api" });

    const response = await server.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "route_not_found",
      message: expect.any(String) as string,
    });
  });
});

describe("application with the embedded database", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "neurons-app-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const embeddedConfig = () =>
    ({ ...baseConfig, mode: "all", dataDir, database: { kind: "embedded" } }) satisfies AppConfig;

  it("boots without any Postgres, reports it on /health and keeps the data across restarts", async () => {
    const first = await start(embeddedConfig());
    const health = await first.inject({ method: "GET", url: "/health" });
    await first.get(DatabaseService).db.insert(graphs).values({ name: "Sobrevive ao reinício" });
    await first.close();

    const second = await start(embeddedConfig());

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      database: { type: "embedded", status: "up" },
    });
    const rows = await second.get(DatabaseService).db.select().from(graphs);
    expect(rows.map((row) => row.name)).toEqual(["Sobrevive ao reinício"]);
  });
});
