import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeState } from "@neurons/agent-runtimes";
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
});
