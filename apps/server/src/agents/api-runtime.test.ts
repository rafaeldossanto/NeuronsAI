import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeState, OutputDelta } from "@neurons/agent-runtimes";
import type { ModelDelta } from "@neurons/providers";
import type { AgentNode } from "@neurons/graph-schema";
import { ApiRuntime, type TurnClient } from "./api-runtime.js";

const agent: AgentNode = {
  id: "a",
  type: "agent",
  name: "Pesquisador",
  position: { x: 0, y: 0 },
  role: "",
  instructions: "",
  effort: "high",
  runtime: { kind: "api", provider: "openai", model: "modelo-de-teste", secretName: "minha-chave" },
};
const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 };
const comm = () => ({
  sendMessage: vi.fn(),
  ask: vi.fn(),
  reply: vi.fn(),
  listPeers: () => ({ canMessage: [], canBeMessagedBy: [] }),
  finish: vi.fn().mockResolvedValue(undefined),
  reportUsage: vi.fn().mockResolvedValue(undefined),
  reportToolCall: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue([{ nodeId: "memoria", name: "obsidian_read" }]),
  useTool: vi.fn().mockResolvedValue({ ok: true, content: "Contexto da memória" }),
});

describe("agente de API", () => {
  it("usa a chave nomeada, mantém a sessão e chega às ferramentas autorizadas antes de concluir", async () => {
    const communication = comm();
    const client: TurnClient = {
      addMessage: vi.fn(),
      result: vi.fn(),
      respond: vi
        .fn()
        .mockResolvedValueOnce({ usage, calls: [{ id: "1", name: "list_tools", input: "{}" }] })
        .mockResolvedValueOnce({
          usage,
          calls: [
            {
              id: "2",
              name: "use_tool",
              input: JSON.stringify({
                nodeId: "memoria",
                name: "obsidian_read",
                input: { path: "Nota.md" },
              }),
            },
          ],
        })
        .mockResolvedValueOnce({
          usage,
          calls: [{ id: "3", name: "finish", input: '{"result":"Pesquisa concluída"}' }],
        }),
    };
    const resolveSecret = vi.fn().mockResolvedValue("segredo-usado-apenas-pelo-sdk");
    const runtime = new ApiRuntime(agent, communication, {
      resolveSecret,
      createClient: () => client,
    });
    await runtime.start("Instruções");
    await runtime.deliver({
      id: "m",
      from: "@human",
      kind: "message",
      body: "Pesquise nas notas",
      replyTo: null,
    });
    await vi.waitFor(() => expect(communication.finish).toHaveBeenCalledWith("Pesquisa concluída"));
    await runtime.stop();
    expect(resolveSecret).toHaveBeenCalledWith("minha-chave");
    expect(communication.useTool).toHaveBeenCalledWith("memoria", "obsidian_read", {
      path: "Nota.md",
    });
    expect(communication.reportUsage).toHaveBeenCalledTimes(3);
    expect(runtime.state).toBe("stopped");
    expect(JSON.stringify(vi.mocked(client.result).mock.calls)).not.toContain(
      "segredo-usado-apenas-pelo-sdk",
    );
  });

  it("muda para waiting_reply ao perguntar e volta a idle após receber a resposta", async () => {
    let answer!: (text: string) => void;
    const communication = comm();
    communication.ask = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const client: TurnClient = {
      addMessage: vi.fn(),
      result: vi.fn(),
      respond: vi
        .fn()
        .mockResolvedValueOnce({
          usage,
          calls: [{ id: "1", name: "ask", input: '{"to":"Revisor","question":"Certo?"}' }],
        })
        .mockResolvedValueOnce({ usage, calls: [] }),
    };
    const runtime = new ApiRuntime(agent, communication, {
      resolveSecret: () => Promise.resolve("chave-de-teste"),
      createClient: () => client,
    });
    const states: AgentRuntimeState[] = [];
    runtime.onStateChange((state) => states.push(state));
    await runtime.start("Papel");
    await runtime.deliver({
      id: "m",
      from: "@human",
      kind: "message",
      body: "Pergunte",
      replyTo: null,
    });
    await vi.waitFor(() => expect(runtime.state).toBe("waiting_reply"));
    answer("Sim");
    await vi.waitFor(() => expect(runtime.state).toBe("idle"));
    expect(states).toContain("waiting_reply");
    await runtime.stop();
  });

  it("não transforma uma escolha de assinatura em cobrança silenciosa de API", async () => {
    const node = { ...agent, runtime: { ...agent.runtime, access: "subscription" as const } };
    const resolveSecret = vi.fn();
    await expect(new ApiRuntime(node, comm(), { resolveSecret }).start("Papel")).rejects.toThrow(
      "assinatura",
    );
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  describe("streaming token por token", () => {
    const delivered = {
      id: "m",
      from: "@human",
      kind: "message" as const,
      body: "Escreva",
      replyTo: null,
    };

    /** A model that writes free text and a message to a peer, piece by piece, then finishes. */
    function scriptedClient(): TurnClient {
      const pieces: ModelDelta[] = [
        { type: "text", text: "Vou " },
        { type: "text", text: "avisar." },
        { type: "toolArguments", callId: "c1", tool: "send_message", text: '{"to":"Revisor","te' },
        { type: "toolArguments", callId: "c1", tool: "send_message", text: 'xt":"Olá, ' },
        { type: "toolArguments", callId: "c1", tool: "send_message", text: 'revisor"}' },
        { type: "toolArguments", callId: "c2", tool: "finish", text: '{"result":"segredo-final"}' },
      ];
      return {
        addMessage: vi.fn(),
        result: vi.fn(),
        respond: vi
          .fn()
          .mockImplementationOnce((_b, _t, _s, options?: { onDelta?: (d: ModelDelta) => void }) => {
            for (const piece of pieces) options?.onDelta?.(piece);
            return Promise.resolve({
              text: "Vou avisar.",
              usage,
              calls: [
                { id: "c1", name: "send_message", input: '{"to":"Revisor","text":"Olá, revisor"}' },
                { id: "c2", name: "finish", input: '{"result":"segredo-final"}' },
              ],
            });
          }),
      };
    }

    it("publica o texto livre e o corpo da mensagem enquanto o modelo escreve, sem vazar outras ferramentas", async () => {
      const communication = comm();
      communication.sendMessage = vi.fn().mockResolvedValue({ messageId: "x" });
      const runtime = new ApiRuntime(agent, communication, {
        resolveSecret: () => Promise.resolve("chave"),
        createClient: () => scriptedClient(),
      });
      const seen: OutputDelta[] = [];
      runtime.onOutputDelta((delta) => seen.push(delta));
      await runtime.start("Papel");
      await runtime.deliver(delivered);
      await vi.waitFor(() => expect(communication.finish).toHaveBeenCalled());
      await runtime.stop();

      const text = seen.filter((delta) => delta.channel === "text");
      const message = seen.filter((delta) => delta.channel === "message");
      expect(text.map((delta) => delta.delta).join("")).toBe("Vou avisar.");
      expect(message.map((delta) => delta.delta).join("")).toBe("Olá, revisor");
      // Grouped, not one per piece; a text and each message have their own turnId.
      expect(seen.length).toBeLessThan(6);
      expect(new Set(text.map((delta) => delta.turnId)).size).toBe(1);
      expect(new Set(message.map((delta) => delta.turnId)).size).toBe(1);
      expect(message[0]!.turnId).not.toBe(text[0]!.turnId);
      // `finish` has no message body: its arguments never reach the screen.
      expect(JSON.stringify(seen)).not.toContain("segredo-final");
      // The free text stays out of the communication between agents.
      expect(communication.sendMessage).toHaveBeenCalledWith("Revisor", "Olá, revisor");
    });

    it("entrega o que já escreveu quando o modelo falha no meio, e o agente falha", async () => {
      const client: TurnClient = {
        addMessage: vi.fn(),
        result: vi.fn(),
        respond: vi.fn((_b, _t, _s, options?: { onDelta?: (d: ModelDelta) => void }) => {
          options?.onDelta?.({ type: "text", text: "meio" });
          return Promise.reject(new Error("conexão caiu"));
        }),
      };
      const runtime = new ApiRuntime(agent, comm(), {
        resolveSecret: () => Promise.resolve("chave"),
        createClient: () => client,
      });
      const seen: OutputDelta[] = [];
      runtime.onOutputDelta((delta) => seen.push(delta));
      await runtime.start("Papel");
      await runtime.deliver(delivered);
      await vi.waitFor(() => expect(runtime.state).toBe("failed"));
      expect(seen.map((delta) => delta.delta).join("")).toBe("meio");
      expect(runtime.failureReason).not.toContain("conexão caiu");
      await runtime.stop();
    });
  });
});
