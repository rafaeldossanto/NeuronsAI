import {
  defaultProviders,
  UsageCalculator,
  type ProviderRegistry,
  type TurnClient,
} from "@neurons/providers";
export type { ModelTurn, TurnClient } from "@neurons/providers";
import {
  Signal,
  type AgentCommunication,
  type AgentRuntime,
  type AgentRuntimeFactory,
  type AgentRuntimeState,
  type InboundMessage,
} from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import { z } from "zod";
import { resourceScope } from "../accounts/resource-scope.js";

const communicationTools = [
  {
    name: "send_message",
    description: "Envia mensagem a um par.",
    schema: z.object({ to: z.string(), text: z.string() }),
  },
  {
    name: "ask",
    description: "Pergunta a um par e espera resposta.",
    schema: z.object({ to: z.string(), question: z.string() }),
  },
  {
    name: "reply",
    description: "Responde uma mensagem pelo id.",
    schema: z.object({ messageId: z.string(), text: z.string() }),
  },
  { name: "list_peers", description: "Lista os pares do grafo.", schema: z.object({}) },
  {
    name: "finish",
    description: "Conclui a execução inteira com o resultado final.",
    schema: z.object({ result: z.string() }),
  },
  {
    name: "list_tools",
    description: "Lista ferramentas e memórias autorizadas no grafo.",
    schema: z.object({}),
  },
  {
    name: "use_tool",
    description: "Usa uma ferramenta ou memória obtida com list_tools.",
    schema: z.object({
      nodeId: z.string(),
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
  },
];

export interface ApiRuntimeDeps {
  resolveSecret(name: string): Promise<string>;
  providers?: ProviderRegistry;
  createClient?(agent: AgentNode, key: string): TurnClient;
}

export class ApiRuntimeFactory implements AgentRuntimeFactory {
  constructor(private readonly deps: ApiRuntimeDeps) {}
  create(agent: AgentNode, communication: AgentCommunication) {
    return new ApiRuntime(agent, communication, {
      ...this.deps,
      resolveSecret: resourceScope.bind((name: string) => this.deps.resolveSecret(name)),
    });
  }
}

export class ApiRuntime implements AgentRuntime {
  private readonly calculator = new UsageCalculator();
  get reportsCost(): boolean {
    const runtime = this.agent.runtime;
    return (
      runtime.kind === "api" && Boolean(this.calculator.price(runtime.provider, runtime.model))
    );
  }
  private current: AgentRuntimeState = "starting";
  private readonly changed = new Signal<AgentRuntimeState>();
  private readonly lifetime = new AbortController();
  private client: TurnClient | undefined;
  private briefing = "";
  private work: Promise<void> = Promise.resolve();
  private finishing = false;
  failureReason: string | undefined;
  constructor(
    private readonly agent: AgentNode,
    private readonly communication: AgentCommunication,
    private readonly deps: ApiRuntimeDeps,
  ) {}
  get state() {
    return this.current;
  }
  onStateChange(listener: (state: AgentRuntimeState) => void) {
    return this.changed.subscribe(listener);
  }
  private setState(state: AgentRuntimeState) {
    this.current = state;
    this.changed.emit(state);
  }
  async start(briefing: string) {
    const runtime = this.agent.runtime;
    if (runtime.kind !== "api" || runtime.access === "subscription")
      throw new Error(
        "Este runtime requer uma chave de API. A integração de assinatura ainda não está disponível.",
      );
    if (!runtime.secretName && runtime.provider !== "openai-compatible")
      throw new Error("Selecione uma chave salva nas propriedades deste agente.");
    const key = runtime.secretName ? await this.deps.resolveSecret(runtime.secretName) : "local";
    this.client =
      this.deps.createClient?.(this.agent, key) ??
      (this.deps.providers ?? defaultProviders()).createSession(
        runtime.provider,
        runtime.model,
        key,
        this.agent.effort,
      );
    this.briefing = briefing;
    this.setState("idle");
  }
  deliver(message: InboundMessage): Promise<void> {
    if (this.current !== "idle" || !this.client)
      return Promise.reject(new Error("O agente de API não está disponível."));
    this.setState("busy");
    this.client.addMessage(
      `[${message.kind}] De ${message.from}; id ${message.id}\n${message.body}`,
    );
    this.work = this.turn().catch(() => {
      if (!this.lifetime.signal.aborted) {
        this.failureReason =
          "O provedor recusou ou não concluiu a solicitação. Confira a chave, o modelo e os limites da conta.";
        this.setState("failed");
      }
    });
    return Promise.resolve();
  }
  private async turn() {
    const tools = communicationTools.map(({ name, description, schema }) => ({
      name,
      description,
      parameters: z.toJSONSchema(schema),
    }));
    for (let step = 0; step < 20 && !this.lifetime.signal.aborted; step++) {
      const result = await this.client!.respond(this.briefing, tools, this.lifetime.signal);
      const runtime = this.agent.runtime;
      const cost =
        runtime.kind === "api"
          ? this.calculator.calculate(
              runtime.provider,
              result.usage.model ?? runtime.model,
              result.usage,
            )
          : undefined;
      await this.communication.reportUsage({
        ...result.usage,
        ...(cost !== undefined && { costUsd: cost }),
      });
      if (!result.calls.length) {
        this.setState("idle");
        return;
      }
      for (const call of result.calls) {
        let response: unknown;
        try {
          const schema = communicationTools.find((tool) => tool.name === call.name)?.schema;
          if (!schema) throw new Error("Ferramenta não autorizada.");
          const input = schema.parse(JSON.parse(call.input)) as Record<string, unknown>;
          response = await this.invoke(call.name, input);
        } catch (error) {
          response = { error: error instanceof Error ? error.message : "Falha na ferramenta." };
        }
        this.client!.result(call, JSON.stringify(response ?? null));
        if (this.finishing || this.lifetime.signal.aborted) return;
      }
    }
    if (!this.lifetime.signal.aborted) throw new Error("Limite de chamadas por turno atingido.");
  }
  private async invoke(name: string, input: Record<string, unknown>) {
    const hub = this.communication;
    switch (name) {
      case "send_message":
        return hub.sendMessage(input.to as string, input.text as string);
      case "ask":
        this.setState("waiting_reply");
        try {
          return await hub.ask(input.to as string, input.question as string);
        } finally {
          if (!this.lifetime.signal.aborted) this.setState("busy");
        }
      case "reply":
        return hub.reply(input.messageId as string, input.text as string);
      case "list_peers":
        return hub.listPeers();
      case "list_tools":
        return hub.listTools?.() ?? [];
      case "use_tool":
        if (!hub.useTool) throw new Error("Ferramentas indisponíveis.");
        return hub.useTool(
          input.nodeId as string,
          input.name as string,
          input.input as Record<string, unknown>,
        );
      case "finish":
        this.finishing = true;
        return hub.finish(input.result as string);
    }
  }
  async stop() {
    if (!this.finishing) this.lifetime.abort();
    await this.work;
    this.setState("stopped");
  }
}
