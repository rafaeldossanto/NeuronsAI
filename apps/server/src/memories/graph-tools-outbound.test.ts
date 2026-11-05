import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { graphDefinitionSchema } from "@neurons/graph-schema";
import { RunRegistry } from "../hub/run-registry.js";
import type { SecretsService } from "../secrets/secrets.service.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { loadConfig } from "../shared/config/app-config.js";
import { GraphToolsService } from "./graph-tools.service.js";
import type { MemoriesService } from "./memories.service.js";

let server: Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = createServer((_request, response) => {
    hits += 1;
    response.end("resposta interna");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function toolsFor(url: string, config: ReturnType<typeof testConfig>) {
  const registry = new RunRegistry();
  registry.register(
    "run",
    graphDefinitionSchema.parse({
      schemaVersion: 1,
      id: "fb1c7cd7-7912-4c4b-bb1a-325030d6257a",
      name: "Teste",
      nodes: [
        {
          id: "agente",
          type: "agent",
          name: "Alfa",
          position: { x: 0, y: 0 },
          role: "",
          instructions: "",
          effort: "medium",
          runtime: { kind: "api", provider: "openai", model: "modelo" },
        },
        {
          id: "externa",
          type: "tool",
          name: "Externa",
          position: { x: 0, y: 200 },
          tool: { kind: "http", method: "GET", url, headers: {} },
        },
        {
          id: "start",
          type: "trigger",
          position: { x: 0, y: 0 },
          kind: "manual",
          target: "agente",
        },
      ],
      links: [{ id: "uso", from: "agente", to: "externa", kind: "uses", readOnly: false }],
      annotations: [],
    }),
  );
  return new GraphToolsService(
    registry,
    {} as unknown as MemoriesService,
    { get: vi.fn() } as unknown as SecretsService,
    config,
  );
}

const call = (tools: GraphToolsService) =>
  tools.use("run", "Alfa", "externa", "Externa", {}, () => Promise.resolve());

describe("ferramentas HTTP e a guarda de saída do servidor", () => {
  it("no perfil local o usuário alcança o próprio localhost", async () => {
    const before = hits;
    const config = loadConfig({ NEURONS_PROFILE: "local" });
    const result = await call(toolsFor(`http://127.0.0.1:${port}/`, testConfig(config)));
    expect(result).toMatchObject({ ok: true, content: "resposta interna" });
    expect(hits).toBe(before + 1);
  });

  it.each(["hybrid", "hosted"])(
    "no perfil %s barra loopback e metadados da nuvem sem tocar o destino",
    async (profile) => {
      const before = hits;
      const config = testConfig({
        outbound: loadConfig({ NEURONS_PROFILE: profile }).outbound!,
      });
      const loopback = await call(toolsFor(`http://127.0.0.1:${port}/`, config));
      expect(loopback).toMatchObject({ ok: false, error: { code: "DESTINATION_BLOCKED" } });
      const metadata = await call(toolsFor("http://169.254.169.254/latest/meta-data/", config));
      expect(metadata).toMatchObject({ ok: false, error: { code: "DESTINATION_BLOCKED" } });
      expect(hits).toBe(before);
    },
  );

  it("a lista de permissão da configuração abre a exceção", async () => {
    const before = hits;
    const config = testConfig({
      outbound: loadConfig({
        NEURONS_PROFILE: "hybrid",
        NEURONS_OUTBOUND_ALLOW_HOSTS: "127.0.0.1",
      }).outbound!,
    });
    const result = await call(toolsFor(`http://127.0.0.1:${port}/`, config));
    expect(result).toMatchObject({ ok: true });
    expect(hits).toBe(before + 1);
  });
});
