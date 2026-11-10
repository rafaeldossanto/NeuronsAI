import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect, type AddressInfo } from "node:net";
import { once } from "node:events";
import { Logger } from "@nestjs/common";
import { expect, it, vi } from "vitest";
import { createApp } from "./create-app.js";
import { DatabaseService } from "./database/database.service.js";
import { Supervisor } from "./hub/supervisor.js";
import { testConfig } from "./shared/config/testing/test-config.js";

it("drains agents before closing the database and closes unfinished HTTP clients", async () => {
  Logger.overrideLogger(false);
  const dataDir = await mkdtemp(path.join(tmpdir(), "neurons-shutdown-order-"));
  const app = await createApp(testConfig({ dataDir }));
  await app.listen(0, "127.0.0.1");
  const database = app.get(DatabaseService);
  const order: string[] = [];
  const stop = app.get(Supervisor).stopAll.bind(app.get(Supervisor));
  vi.spyOn(app.get(Supervisor), "stopAll").mockImplementation(async () => {
    await database.ping();
    await stop();
    order.push("agents");
  });
  const close = database.onApplicationShutdown.bind(database);
  vi.spyOn(database, "onApplicationShutdown").mockImplementation(async () => {
    expect(order).toEqual(["agents"]);
    await close();
    order.push("database");
  });
  const socket = connect((app.getHttpServer().address() as AddressInfo).port, "127.0.0.1");
  socket.on("error", () => undefined);
  await once(socket, "connect");
  socket.write(
    "POST /graphs HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n{",
  );
  try {
    await app.close();
    expect(order).toEqual(["agents", "database"]);
  } finally {
    socket.destroy();
  }
});
