import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerSlowRequestLog } from "./slow-request-log.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build(thresholdMs: number) {
  const warn = vi.fn();
  const app = Fastify();
  apps.push(app);
  registerSlowRequestLog(app, { thresholdMs, logger: { warn } });
  app.get("/runs/:id", async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { ok: true };
  });
  app.get("/fast", () => ({ ok: true }));
  await app.ready();
  return { app, warn };
}

it("logs a slow request with the route pattern, never the URL, query or ids", async () => {
  const { app, warn } = await build(30);
  await app.inject({
    method: "GET",
    url: "/runs/run-secret-123?token=abc&email=a@b.com",
    headers: { authorization: "Bearer nsa_x" },
  });
  expect(warn).toHaveBeenCalledTimes(1);
  const line = String(warn.mock.calls[0]![0]);
  expect(line).toMatch(/^GET \/runs\/:id 200 \d+ ms$/);
  for (const secret of ["run-secret-123", "token", "abc", "a@b.com", "nsa_x"])
    expect(line).not.toContain(secret);
});

it("stays silent below the threshold", async () => {
  const { app, warn } = await build(5_000);
  await app.inject({ method: "GET", url: "/fast" });
  await app.inject({ method: "GET", url: "/runs/1" });
  expect(warn).not.toHaveBeenCalled();
});

it("names an unmatched route without echoing the path", async () => {
  const { app, warn } = await build(0);
  await app.inject({ method: "GET", url: "/nada/segredo-9" });
  expect(String(warn.mock.calls[0]![0])).toMatch(/^GET \(sem rota\) 404 \d+ ms$/);
});
