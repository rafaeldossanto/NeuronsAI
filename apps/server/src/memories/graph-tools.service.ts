import { Inject, Injectable } from "@nestjs/common";
import { toolsOf, type ToolNode } from "@neurons/graph-schema";
import { createTools, type ToolSet } from "@neurons/tools";
import { SecretsService } from "../secrets/secrets.service.js";
import { RunRegistry } from "../hub/run-registry.js";
import type { ToolCallReport } from "@neurons/agent-runtimes";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { MemoriesService, MemoryError } from "./memories.service.js";
import { resourceScope } from "../accounts/resource-scope.js";

@Injectable()
export class GraphToolsService {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    @Inject(RunRegistry) private readonly runs: RunRegistry,
    @Inject(MemoriesService) private readonly memories: MemoriesService,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  list(runId: string, agent: string) {
    const owner = this.runs.requireOpen(runId);
    return resourceScope.run({ organizationId: owner.organizationId }, () =>
      this.listScoped(runId, agent),
    );
  }

  private async listScoped(runId: string, agent: string) {
    const graph = this.runs.require(runId).graph;
    const descriptions = [];
    for (const node of toolsOf(graph, agent)) {
      const set = await this.open(runId, agent, node.id);
      try {
        descriptions.push(
          ...set.tools.map((tool) => ({
            nodeId: node.id,
            name: tool.name,
            description: `${node.name}: ${tool.description}`,
            inputSchema: tool.inputSchema,
          })),
        );
      } finally {
        await set.close();
      }
    }
    return descriptions;
  }

  use(
    runId: string,
    agent: string,
    nodeId: string,
    name: string,
    input: Record<string, unknown>,
    report: (record: ToolCallReport) => Promise<void>,
  ): Promise<unknown> {
    const owner = this.runs.requireOpen(runId);
    return resourceScope.run({ organizationId: owner.organizationId }, () =>
      this.useScoped(runId, agent, nodeId, name, input, report),
    );
  }

  private async useScoped(
    runId: string,
    agent: string,
    nodeId: string,
    name: string,
    input: Record<string, unknown>,
    report: (record: ToolCallReport) => Promise<void>,
  ): Promise<unknown> {
    const node = this.allowed(runId, agent, nodeId);
    const key =
      node.tool.kind === "obsidian"
        ? (node.tool.memoryId ?? node.tool.vaultPath ?? node.id)
        : node.id;
    const previous = this.pending.get(key) ?? Promise.resolve();
    const work = previous
      .catch(() => undefined)
      .then(async () => {
        const set = await this.open(runId, agent, nodeId);
        try {
          const tool = set.tools.find((entry) => entry.name === name);
          if (!tool)
            throw new MemoryError(
              "forbidden",
              "tool_not_allowed",
              "Esta operação não está autorizada para este agente.",
            );
          const start = Date.now();
          const result = await tool.execute(input, {
            signal: AbortSignal.timeout(30_000),
            secrets: { resolve: (key) => this.secrets.get(key) },
          });
          await report({
            tool: name,
            inputSummary: JSON.stringify({
              nodeId,
              ...(typeof input.path === "string" && { path: input.path }),
            }),
            durationMs: Date.now() - start,
            ok: result.ok,
            ...(!result.ok && { errorCode: result.error.code }),
          });
          return result;
        } finally {
          await set.close();
        }
      });
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }
  }

  private allowed(runId: string, agent: string, nodeId: string): ToolNode {
    const node = toolsOf(this.runs.require(runId).graph, agent).find(
      (entry) => entry.id === nodeId,
    );
    if (!node)
      throw new MemoryError(
        "forbidden",
        "tool_not_connected",
        "O agente não está ligado a esta ferramenta nesta execução.",
      );
    return node;
  }

  private async open(runId: string, agent: string, nodeId: string): Promise<ToolSet> {
    const original = this.allowed(runId, agent, nodeId);
    if (
      resourceScope.current().organizationId !== null &&
      original.tool.kind === "mcp" &&
      original.tool.transport === "stdio"
    )
      throw new MemoryError(
        "unavailable",
        "shared_stdio_unavailable",
        "Neste servidor, conecte um MCP por HTTP. Processos locais pertencem ao computador do runner.",
      );
    let node = original;
    if (original.tool.kind === "obsidian") {
      const graph = this.runs.require(runId).graph;
      const agentId = graph.nodes.find(
        (entry) => entry.type === "agent" && entry.name === agent,
      )?.id;
      const link = graph.links.find(
        (entry) => entry.kind === "uses" && entry.from === agentId && entry.to === nodeId,
      );
      if (
        !original.tool.memoryId &&
        (this.config.profile !== "local" || resourceScope.current().organizationId !== null)
      )
        throw new MemoryError(
          "unavailable",
          "local_memory_unavailable",
          "Importe esta memória para o servidor antes de usá-la neste perfil.",
        );
      const vaultPath = original.tool.memoryId
        ? await this.memories.resolve(original.tool.memoryId)
        : original.tool.vaultPath;
      node = {
        ...original,
        tool: {
          kind: "obsidian",
          vaultPath,
          readOnly: original.tool.readOnly || link?.readOnly === true,
        },
      };
    }
    return createTools(node, { secrets: { resolve: (name) => this.secrets.get(name) } });
  }
}
