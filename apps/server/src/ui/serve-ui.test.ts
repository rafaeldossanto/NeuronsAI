import "reflect-metadata";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../create-app.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { CONTENT_SECURITY_POLICY, rewriteForUi } from "./serve-ui.js";

const config = {
  mode: "all",
  host: "127.0.0.1",
  port: 0,
  guards: { runMaxMessages: 200, pingPongMessages: 20 },
  terminalInput: { maxChars: 4_096, maxPerSecond: 100 },
  profile: "local",
  runners: { graceMs: 60_000, heartbeatMs: 15_000, waitMs: 1_000 },
  usageFlushMs: 0,
  askTimeoutMs: 1000,
  dataDir: "unused",
  database: { kind: "postgres" },
} satisfies AppConfig;

describe("rewriteForUi", () => {
  it.each([
    ["/api/graphs", "/graphs"],
    ["/api/graphs?limit=2", "/graphs?limit=2"],
    ["/api", "/"],
    ["/api?x=1", "/?x=1"],
    ["/ws", "/ws"],
    ["/", "/__ui__/"],
    ["/graphs/42", "/__ui__/graphs/42"],
    ["/apiary", "/__ui__/apiary"],
  ])("%s -> %s", (from, to) => {
    expect(rewriteForUi(from)).toBe(to);
  });
});

describe("server with the interface", () => {
  let root: string;
  let app: NestFastifyApplication | undefined;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "neurons-ui-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>NeuronsAI</title>");
    await writeFile(path.join(root, "assets", "app-1.js"), "console.log(1)");
    await writeFile(path.join(root, "..", `${path.basename(root)}-secret.txt`), "segredo");
    app = await createApp(config, { ui: { root } });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-secret.txt`, { force: true });
  });

  it("serves index.html at the root and for client-side routes, with the CSP", async () => {
    for (const url of ["/", "/graphs/abc", "/runs"]) {
      const response = await app!.inject({ method: "GET", url });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
      expect(response.body).toContain("NeuronsAI");
    }
  });

  it("serves built assets with their type and long caching", async () => {
    const response = await app!.inject({ method: "GET", url: "/assets/app-1.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("answers 404 for a missing asset instead of the page", async () => {
    const response = await app!.inject({ method: "GET", url: "/assets/missing.js" });

    expect(response.statusCode).toBe(404);
  });

  it("does not leave the interface folder", async () => {
    const secret = `${path.basename(root)}-secret.txt`;
    for (const url of [`/..%2F${secret}`, `/%2e%2e/${secret}`, `/assets/..%2F..%2F${secret}`]) {
      const response = await app!.inject({ method: "GET", url });

      expect(response.statusCode).not.toBe(200);
      expect(response.body).not.toContain("segredo");
    }
  });

  it("keeps the API under /api", async () => {
    const response = await app!.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });
});

it("serves landing assets under their own prefix with CSP and without shadowing editor assets", async () => {
  Logger.overrideLogger(false);
  const root = await mkdtemp(path.join(tmpdir(), "neurons-landing-assets-"));
  const landing = path.join(root, "landing");
  await mkdir(path.join(landing, "assets"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "editor");
  await writeFile(
    path.join(landing, "index.html"),
    '<script src="./assets/site.js"></script><link href="./assets/site.css" rel="stylesheet">',
  );
  await writeFile(path.join(landing, "assets", "site.js"), 'console.log("site")');
  const app = await createApp(config, { ui: { root, landingRoot: landing } });
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const index = await app.inject({ method: "GET", url: "/" });
    expect(index.body).toContain("/__landing__/assets/site.js");
    expect(index.headers["content-security-policy"]).toContain("script-src 'self'");
    // The page asks GitHub for the latest release: without this origin the download links stay generic.
    expect(index.headers["content-security-policy"]).toContain(
      "connect-src 'self' https://api.github.com",
    );
    expect((await app.inject({ method: "GET", url: "/__landing__/assets/site.js" })).body).toBe(
      'console.log("site")',
    );
    expect(
      (await app.inject({ method: "GET", url: "/__landing__/assets/missing.js" })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: "GET", url: "/graphs" })).body).toBe("editor");
  } finally {
    await app.close();
  }
});
