import { randomUUID } from "node:crypto";
import { createMemoryChannelPair, PROTOCOL_VERSION } from "@neurons/runner-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { RunnerRegistry } from "../runners/runner-registry.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { resourceScope } from "./resource-scope.js";

const registry = new RunnerRegistry(
  testConfig({ runners: { graceMs: 1000, heartbeatMs: 1000, waitMs: 500 } }),
);
const alice = randomUUID(),
  bob = randomUUID();
afterEach(() => registry.onApplicationShutdown());
function connect(organizationId: string | null) {
  const pair = createMemoryChannelPair();
  const id = randomUUID();
  registry.accept({ id, name: "runner", ...(organizationId && { organizationId }) }, pair.server);
  pair.runner.send({
    v: PROTOCOL_VERSION,
    type: "register",
    runner: { name: "runner", platform: "linux" },
    capabilities: { terminal: true, streamJson: true },
    agents: [],
  });
  return id;
}

describe("seleção de runner por organização", () => {
  it("escolhe apenas runners do mesmo namespace, incluindo o workspace local", async () => {
    const a = connect(alice),
      b = connect(bob),
      local = connect(null);
    expect(await resourceScope.run({ organizationId: alice }, () => registry.acquire())).toBe(
      registry.find(a),
    );
    expect(await resourceScope.run({ organizationId: bob }, () => registry.acquire())).toBe(
      registry.find(b),
    );
    expect(await registry.acquire()).toBe(registry.find(local));
  });
  it("não resolve a espera quando só um runner de outra organização chega", async () => {
    const waiting = resourceScope.run({ organizationId: alice }, () => registry.acquire());
    const rejected = expect(waiting).rejects.toThrow("Nenhum runner");
    connect(bob);
    await rejected;
  });
  it("captura a organização da espera e ignora conexões alheias até a conexão correta", async () => {
    const waiting = resourceScope.run({ organizationId: alice }, () => registry.acquire());
    connect(bob);
    const id = connect(alice);
    expect(await waiting).toBe(registry.find(id));
  });
  it("mantém callbacks ligados à organização original mesmo chamados sob outro contexto", async () => {
    const bound = resourceScope.run({ organizationId: alice }, () =>
      resourceScope.bind(async () => {
        await Promise.resolve();
        return resourceScope.current().organizationId;
      }),
    );
    expect(await resourceScope.run({ organizationId: bob }, bound)).toBe(alice);
    expect(resourceScope.current().organizationId).toBeNull();
  });
});

it("selects the requested runner without crossing organization boundaries", async () => {
  const own = connect(alice),
    other = connect(bob);
  connect(alice);
  expect(await resourceScope.run({ organizationId: alice }, () => registry.acquire(own))).toBe(
    registry.find(own),
  );
  await expect(
    resourceScope.run({ organizationId: alice }, () => registry.acquire(other)),
  ).rejects.toThrow("Nenhum runner");
});
