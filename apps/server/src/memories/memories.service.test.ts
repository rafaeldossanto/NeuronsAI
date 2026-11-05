import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphDefinitionSchema } from "@neurons/graph-schema";
import { RunRegistry } from "../hub/run-registry.js";
import type { SecretsService } from "../secrets/secrets.service.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { GraphToolsService } from "./graph-tools.service.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { QuotaExceededError } from "../shared/errors/quota-exceeded.error.js";
import { importPath, MemoriesService } from "./memories.service.js";

let root: string;
let memories: MemoriesService;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "neurons-memories-"));
  memories = new MemoriesService(testConfig({ dataDir: root }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const encoded = (content: string) => Buffer.from(content).toString("base64");

describe("biblioteca de memórias", () => {
  it("persiste cópia de notas e anexos, conservando diretórios e links após reiniciar o serviço", async () => {
    const item = await memories.create({
      name: "Projeto",
      storage: "server",
      files: [
        { path: "Pasta/Decisões.md", data: encoded("# Decisões\n[[Plano]]") },
        { path: "Anexos/figura.png", data: encoded("imagem") },
      ],
    });
    const reopened = new MemoriesService(testConfig({ dataDir: root, profile: "hybrid" }));
    expect(await reopened.list()).toEqual([item]);
    expect(
      await readFile(path.join(await reopened.resolve(item.id), "Pasta/Decisões.md"), "utf8"),
    ).toContain("[[Plano]]");
    expect(
      await readFile(path.join(await reopened.resolve(item.id), "Anexos/figura.png"), "utf8"),
    ).toBe("imagem");
    expect(item.vaultPath).toBeUndefined();
  });

  it.each([
    "../fora.md",
    "a/../../fora.md",
    "C:/fora.md",
    "/absoluto.md",
    ".obsidian/config.json",
    "a/.git/config",
    "Pasta/NUL.md",
    "pasta/nota.md.",
  ])("recusa caminho de importação %s", (name) => {
    expect(() => importPath(name)).toThrow();
  });

  it("não publica importação com duplicidades ou base64 inválido", async () => {
    await expect(
      memories.create({
        name: "Duplicado",
        storage: "server",
        files: [
          { path: "Nota.md", data: encoded("a") },
          { path: "nota.md", data: encoded("b") },
        ],
      }),
    ).rejects.toMatchObject({ code: "duplicate_memory_file" });
    await expect(
      memories.create({
        name: "Inválido",
        storage: "server",
        files: [{ path: "Nota.md", data: "%%%" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_memory_file" });
    expect(await memories.list()).toEqual([]);
  });

  it("cofre local pertence ao computador local e não vira caminho remoto", async () => {
    const vaultPath = path.join(root, "local");
    await mkdir(vaultPath);
    const item = await memories.create({ name: "Local", storage: "local", vaultPath });
    await expect(
      new MemoriesService(testConfig({ dataDir: root, profile: "hybrid" })).resolve(item.id),
    ).rejects.toMatchObject({ code: "local_memory_unavailable" });
  });

  it("autoriza por agente, oferece escrita só à ligação permitida e registra sem conteúdo da nota", async () => {
    const memory = await memories.create({ name: "Memória", storage: "server" });
    const registry = new RunRegistry();
    registry.register(
      "run",
      graphDefinitionSchema.parse({
        schemaVersion: 1,
        id: "fb1c7cd7-7912-4c4b-bb1a-325030d6257a",
        name: "Teste",
        nodes: [
          ...["Escritor", "Leitor", "Intruso"].map((name, i) => ({
            id: name,
            name,
            type: "agent",
            position: { x: i * 200, y: 0 },
            role: "",
            instructions: "",
            effort: "medium",
            runtime: { kind: "api", provider: "openai", model: "modelo" },
          })),
          {
            id: "memoria",
            type: "tool",
            name: "Notas",
            position: { x: 0, y: 200 },
            tool: { kind: "obsidian", memoryId: memory.id, readOnly: false },
          },
          {
            id: "start",
            type: "trigger",
            position: { x: 0, y: 0 },
            kind: "manual",
            target: "Escritor",
          },
        ],
        links: [
          { id: "a", from: "Escritor", to: "memoria", kind: "uses", readOnly: false },
          { id: "b", from: "Leitor", to: "memoria", kind: "uses", readOnly: true },
        ],
        annotations: [],
      }),
    );
    const tools = new GraphToolsService(
      registry,
      memories,
      { get: vi.fn() } as unknown as SecretsService,
      testConfig({ dataDir: root }),
    );
    expect((await tools.list("run", "Escritor")).map((tool) => tool.name)).toContain(
      "obsidian_create",
    );
    expect((await tools.list("run", "Leitor")).map((tool) => tool.name)).not.toContain(
      "obsidian_edit",
    );
    const report = vi.fn().mockResolvedValue(undefined);
    await expect(
      tools.use("run", "Intruso", "memoria", "obsidian_read", { path: "Nova.md" }, report),
    ).rejects.toMatchObject({ code: "tool_not_connected" });
    await expect(
      tools.use(
        "run",
        "Leitor",
        "memoria",
        "obsidian_create",
        { path: "Nova.md", content: "Conteúdo privado" },
        report,
      ),
    ).rejects.toMatchObject({ code: "tool_not_allowed" });
    expect(
      await tools.use(
        "run",
        "Escritor",
        "memoria",
        "obsidian_create",
        { path: "Nova.md", content: "Conteúdo privado" },
        report,
      ),
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(report.mock.calls)).not.toContain("Conteúdo privado");
    expect(
      await tools.use("run", "Leitor", "memoria", "obsidian_read", { path: "Nova.md" }, report),
    ).toMatchObject({ ok: true, content: "Conteúdo privado" });
    const edits = await Promise.all([
      tools.use(
        "run",
        "Escritor",
        "memoria",
        "obsidian_edit",
        { path: "Nova.md", previous: "Conteúdo privado", content: "Versão A" },
        report,
      ),
      tools.use(
        "run",
        "Escritor",
        "memoria",
        "obsidian_edit",
        { path: "Nova.md", previous: "Conteúdo privado", content: "Versão B" },
        report,
      ),
    ]);
    expect(edits[0]).toMatchObject({ ok: true });
    expect(edits[1]).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });
});

describe("cotas de memórias", () => {
  const ORG = "0b000000-0000-4000-8000-000000000001";
  const withQuotas = (quotas: Partial<NonNullable<ReturnType<typeof testConfig>["quotas"]>>) =>
    new MemoriesService(
      testConfig({
        dataDir: root,
        quotas: {
          organizationsPerUser: 0,
          memoriesPerOrganization: 0,
          memoryBytesPerOrganization: 0,
          concurrentRunsPerOrganization: 0,
          runsPerDayPerOrganization: 0,
          ...quotas,
        },
      }),
    );
  const inOrganization = <T>(action: () => T): T =>
    resourceScope.run({ organizationId: ORG }, action);
  const create = (service: MemoriesService, name: string, content = "x") =>
    inOrganization(() =>
      service.create({
        name,
        storage: "server",
        files: [{ path: "nota.md", data: encoded(content) }],
      }),
    );

  it("recusa a memória que passa da quantidade, mas só dentro de uma organização", async () => {
    const service = withQuotas({ memoriesPerOrganization: 2 });
    await create(service, "A");
    await create(service, "B");

    const refused = await create(service, "C").catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(QuotaExceededError);
    expect(refused).toMatchObject({ code: "quota_memories" });
    // The local workspace (no organization) has no quotas.
    for (const name of ["L1", "L2", "L3"]) await service.create({ name, storage: "server" });
    expect(await service.list()).toHaveLength(3);
  });

  it("recusa o que passa do tamanho total da organização e não escreve nada", async () => {
    const service = withQuotas({ memoryBytesPerOrganization: 1000 });
    await create(service, "A", "x".repeat(600));

    await expect(create(service, "B", "x".repeat(600))).rejects.toMatchObject({
      code: "quota_memory_bytes",
    });
    await expect(create(service, "C", "x".repeat(100))).resolves.toMatchObject({ name: "C" });
    expect(await inOrganization(() => service.list())).toHaveLength(2);
  });

  it("zero desliga o limite", async () => {
    const service = withQuotas({ memoriesPerOrganization: 0, memoryBytesPerOrganization: 0 });
    for (const name of ["A", "B", "C"]) await create(service, name);
    expect(await inOrganization(() => service.list())).toHaveLength(3);
  });
});
