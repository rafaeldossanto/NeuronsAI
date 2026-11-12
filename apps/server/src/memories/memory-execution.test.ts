import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";
import { expect, it, vi } from "vitest";
import { createApp } from "../create-app.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { MemoriesService } from "./memories.service.js";

// A full run: the app boots a PGlite, a runner and a child process. On a machine busy with other suites
// it takes several times its ~8 s, so the budgets are generous: they only decide when to give up.
it("terminal → MCP → runner → servidor: cria, lê e edita a memória, com eventos registrados", async () => {
  Logger.overrideLogger(false);
  const directory = await mkdtemp(path.join(tmpdir(), "neurons-memory-run-"));
  const fake = fileURLToPath(
    new URL("../../../../packages/agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
  );
  const app = await createApp(
    testConfig({ dataDir: directory, claudeCommand: { command: process.execPath, args: [fake] } }),
  );
  try {
    await app.listen(0, "127.0.0.1");
    const memory = await app.get(MemoriesService).create({ name: "Notas", storage: "server" });
    const graphReply = await app.inject({
      method: "POST",
      url: "/graphs",
      payload: { name: "Memória executável" },
    });
    const graphId = graphReply.json<{ id: string }>().id;
    const published = await app.inject({
      method: "POST",
      url: `/graphs/${graphId}/versions`,
      payload: {
        definition: {
          schemaVersion: 1,
          id: graphId,
          name: "Memória executável",
          annotations: [],
          nodes: [
            {
              id: "start",
              type: "trigger",
              kind: "manual",
              target: "agent",
              position: { x: 0, y: 0 },
            },
            {
              id: "agent",
              type: "agent",
              name: "Pesquisador",
              role: "",
              instructions: "",
              effort: "medium",
              position: { x: 200, y: 0 },
              runtime: {
                kind: "terminal",
                cli: "claude",
                mode: "stream-json",
                cwd: directory,
                args: [],
              },
            },
            {
              id: "memoria",
              type: "tool",
              name: "Notas",
              position: { x: 200, y: 200 },
              tool: { kind: "obsidian", memoryId: memory.id, readOnly: false },
            },
          ],
          links: [
            {
              id: "uses",
              from: "agent",
              to: "memoria",
              kind: "uses",
              bidirectional: false,
              readOnly: false,
            },
          ],
        },
      },
    });
    expect(published.statusCode).toBe(201);
    const versionId = published.json<{ id: string }>().id;
    const instruction = (name: string, input: Record<string, unknown>) =>
      `!tool ${JSON.stringify({ nodeId: "memoria", name, input })}`;
    const started = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        graphVersionId: versionId,
        input: [
          "!tools",
          instruction("obsidian_create", {
            path: "Projeto/Resultado.md",
            content: "Primeira versão",
          }),
          instruction("obsidian_read", { path: "Projeto/Resultado.md" }),
          instruction("obsidian_edit", {
            path: "Projeto/Resultado.md",
            previous: "Primeira versão",
            content: "Versão final [[Plano]]",
          }),
          instruction("obsidian_read", { path: "Projeto/Resultado.md" }),
          "!finish $last",
        ].join("\n"),
      },
    });
    const runId = started.json<{ id: string }>().id;
    await vi.waitFor(
      async () => {
        const result = (await app.inject({ method: "GET", url: `/runs/${runId}` })).json<{
          status: string;
          finish?: { result?: string };
        }>();
        expect(result.status).toBe("succeeded");
        expect(result.finish?.result).toContain("Versão final");
      },
      { timeout: 90_000, interval: 150 },
    );
    expect(
      await readFile(
        path.join(await app.get(MemoriesService).resolve(memory.id), "Projeto/Resultado.md"),
        "utf8",
      ),
    ).toBe("Versão final [[Plano]]");
    const events = (await app.inject({ method: "GET", url: `/runs/${runId}/events` })).json<{
      items: { type: string; payload: { tool?: string; inputSummary?: string } }[];
    }>();
    expect(
      events.items
        .filter((event) => event.type === "ToolCalled")
        .map((event) => event.payload.tool),
    ).toEqual(["obsidian_create", "obsidian_read", "obsidian_edit", "obsidian_read"]);
    expect(
      events.items
        .filter((event) => event.type === "ToolCalled")
        .every((event) => !event.payload.inputSummary?.includes("Primeira versão")),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
