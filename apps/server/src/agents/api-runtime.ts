import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  Signal,
  type AgentCommunication,
  type AgentRuntime,
  type AgentRuntimeFactory,
  type AgentRuntimeState,
  type InboundMessage,
  type AgentUsage,
} from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import { z } from "zod";
import { resourceScope } from "../accounts/resource-scope.js";

interface FunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
interface ToolCall {
  id: string;
  name: string;
  input: string;
}
export interface ModelTurn {
  calls: ToolCall[];
  usage: AgentUsage;
}
export interface TurnClient {
  addMessage(text: string): void;
  respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn>;
  result: (call: ToolCall, text: string) => void;
}

class OpenAITurnClient implements TurnClient {
  private readonly messages: OpenAI.Responses.ResponseInputItem[] = [];
  private readonly client: OpenAI;
  constructor(
    private readonly model: string,
    key: string,
    private readonly effort: AgentNode["effort"],
  ) {
    this.client = new OpenAI({ apiKey: key, maxRetries: 2, timeout: 90_000 });
  }
  addMessage(text: string) {
    this.messages.push({ role: "user", content: text });
  }
  async respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn> {
    const effort = this.effort === "max" || this.effort === "xhigh" ? "high" : this.effort;
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: briefing,
        input: this.messages,
        store: false,
        // Without storage, reasoning items only round-trip when their encrypted content comes along.
        include: ["reasoning.encrypted_content"],
        max_output_tokens: 8192,
        reasoning: { effort },
        tools: tools.map((tool) => ({ type: "function" as const, ...tool, strict: false })),
      },
      { signal },
    );
    this.messages.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));
    return {
      calls: response.output.flatMap((item) =>
        item.type === "function_call"
          ? [{ id: item.call_id, name: item.name, input: item.arguments }]
          : [],
      ),
      usage: {
        model: response.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
      },
    };
  }
  result(call: ToolCall, text: string) {
    this.messages.push({ type: "function_call_output", call_id: call.id, output: text });
  }
}

class AnthropicTurnClient implements TurnClient {
  private readonly messages: Anthropic.MessageParam[] = [];
  private readonly client: Anthropic;
  constructor(
    private readonly model: string,
    key: string,
    private readonly effort: AgentNode["effort"],
  ) {
    this.client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 90_000 });
  }
  addMessage(text: string) {
    this.messages.push({ role: "user", content: text });
  }
  async respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn> {
    const effort = this.effort === "max" || this.effort === "xhigh" ? "high" : this.effort;
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 8192,
        system: briefing,
        messages: this.messages,
        output_config: { effort },
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: { ...tool.parameters, type: "object" as const },
        })),
      },
      { signal },
    );
    this.messages.push({ role: "assistant", content: response.content });
    return {
      calls: response.content.flatMap((block) =>
        block.type === "tool_use"
          ? [{ id: block.id, name: block.name, input: JSON.stringify(block.input) }]
          : [],
      ),
      usage: {
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
  result(call: ToolCall, text: string) {
    const block: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: call.id,
      content: text,
    };
    const previous = this.messages.at(-1);
    if (previous?.role === "user" && Array.isArray(previous.content)) previous.content.push(block);
    else this.messages.push({ role: "user", content: [block] });
  }
}

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
  readonly reportsCost = false; // Usage has tokens, not a billed USD figure. Never fabricate a zero cost.
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
    if (!runtime.secretName)
      throw new Error("Selecione uma chave salva nas propriedades deste agente.");
    if (!["openai", "anthropic"].includes(runtime.provider))
      throw new Error("Este runtime suporta os provedores OpenAI e Anthropic.");
    const key = await this.deps.resolveSecret(runtime.secretName);
    this.client =
      this.deps.createClient?.(this.agent, key) ??
      (runtime.provider === "openai"
        ? new OpenAITurnClient(runtime.model, key, this.agent.effort)
        : new AnthropicTurnClient(runtime.model, key, this.agent.effort));
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
      await this.communication.reportUsage(result.usage);
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
