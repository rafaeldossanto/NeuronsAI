import { Inject, Injectable, Optional } from "@nestjs/common";
import { toolsOf, writeToolsBlockedFor, type ToolNode } from "@neurons/graph-schema";
import { createTools, type ToolSet } from "@neurons/tools";
import { SecretsService } from "../secrets/secrets.service.js";
import { RunRegistry } from "../hub/run-registry.js";
import type { ToolCallReport } from "@neurons/agent-runtimes";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { MemoriesService, MemoryError } from "./memories.service.js";
import { resourceScope } from "../accounts/resource-scope.js";
import {
  WHATSAPP_MESSAGE_REPOSITORY,
  type WhatsAppMessageRepository,
} from "../triggers/whatsapp-messages.js";

/** Replaces `https://graph.facebook.com` for the WhatsApp reply tool (tests point it at a fake Meta). */
export const WHATSAPP_GRAPH_BASE_URL = Symbol("WHATSAPP_GRAPH_BASE_URL");

@Injectable()
export class GraphToolsService {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    @Inject(RunRegistry) private readonly runs: RunRegistry,
    @Inject(MemoriesService) private readonly memories: MemoriesService,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    @Inject(WHATSAPP_MESSAGE_REPOSITORY)
    private readonly whatsappMessages?: WhatsAppMessageRepository,
    @Optional() @Inject(WHATSAPP_GRAPH_BASE_URL) private readonly whatsappBaseUrl?: string,
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
    const blocked = writeToolsBlockedFor(graph, agent);
    for (const node of toolsOf(graph, agent)) {
      if (blocked.some((entry) => entry.id === node.id)) continue;
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
          const execute = () =>
            tool.execute(input, {
              signal: AbortSignal.timeout(30_000),
              secrets: { resolve: (key) => this.secrets.get(key) },
            });
          const result =
            node.tool.kind === "obsidian"
              ? await this.memories.withNoteWrites(execute)
              : await execute();
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
    // An agent that reads customer messages writes nowhere unless its link says so (allowWrite).
    if (writeToolsBlockedFor(this.runs.require(runId).graph, agent).some((n) => n.id === nodeId))
      throw new MemoryError(
        "forbidden",
        "write_tool_blocked",
        'Este agente lê mensagens de clientes e começa sem ferramentas de escrita. Para liberar, marque "Permitir escrita" na ligação do agente com esta ferramenta.',
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
    return createTools(node, {
      checkNoteWrite: this.memories.checkNoteWrite,
      secrets: { resolve: (name) => this.secrets.get(name) },
      // Public servers keep tools away from loopback, private networks and the cloud metadata address.
      ...(this.config.outbound && { network: this.config.outbound }),
      ...(original.tool.kind === "whatsapp" && {
        whatsapp: {
          // Who the reply goes to is the customer of this run, held by the server: the agent never
          // names (or even sees) a number.
          recipient: async () => {
            const contact = await this.whatsappMessages?.contactOfRun(runId);
            return (
              contact && {
                to: contact.to,
                phoneNumberId: contact.phoneNumberId,
                customerWroteAt: contact.sentAt,
              }
            );
          },
          ...(this.whatsappBaseUrl && { graphBaseUrl: this.whatsappBaseUrl }),
        },
      }),
    });
  }
}
