import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { createApp } from "../../create-app.js";
import { testConfig } from "../config/testing/test-config.js";

it("rejects foreign Host and Origin over HTTP and the WebSocket upgrade", async () => {
  Logger.overrideLogger(false);
  const dataDir = await mkdtemp(path.join(tmpdir(), "neurons-local-network-"));
  const app = await createApp(testConfig({ dataDir, mode: "api" }));
  let client: WebSocket | undefined;
  try {
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    expect(
      (await app.inject({ method: "POST", url: "/graphs", payload: { name: "x".repeat(1100000) } }))
        .statusCode,
    ).toBe(413);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/memories",
          payload: {
            name: "Large import",
            storage: "server",
            files: [{ path: "attachment.bin", data: Buffer.alloc(1000000).toString("base64") }],
          },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await fetch(origin + "/graphs", { headers: { origin: "http://unrelated.invalid" } })).status,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/graphs",
          headers: { host: `rebind.invalid:${port}` },
        })
      ).statusCode,
    ).toBe(403);
    expect((await fetch(origin + "/graphs", { headers: { origin } })).status).toBe(200);
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "http://unrelated.invalid" });
    await expect(once(client, "open")).rejects.toThrow();
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
    await once(client, "open");
  } finally {
    client?.terminate();
    await app.close();
  }
});
