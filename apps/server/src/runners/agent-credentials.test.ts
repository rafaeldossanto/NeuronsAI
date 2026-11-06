import { describe, expect, it, vi } from "vitest";
import type { AgentCommunication } from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import type { RequestFrame } from "@neurons/runner-protocol";
import { RemoteAgentRuntime, type RunnerEndpoint } from "./remote-agent-runtime.js";

const agent: AgentNode = {
  id: "agent",
  type: "agent",
  name: "Escritor",
  position: { x: 0, y: 0 },
  role: "",
  instructions: "",
  effort: "medium",
  runtime: {
    kind: "terminal",
    cli: "claude",
    mode: "pty",
    cwd: "C:/projeto",
    args: [],
    access: "api-key",
    secretName: "claude-projeto",
  },
};
const communication: AgentCommunication = {
  sendMessage: () => Promise.resolve({ messageId: "m" }),
  ask: () => Promise.resolve("resposta"),
  reply: () => Promise.resolve({ messageId: "reply" }),
  listPeers: () => ({ canMessage: [], canBeMessagedBy: [] }),
  finish: () => Promise.resolve(),
  reportUsage: () => Promise.resolve(),
  reportToolCall: () => Promise.resolve(),
};

function setup(revision: number, resolveSecret = vi.fn().mockResolvedValue("credencial-ficticia")) {
  const frames: RequestFrame[] = [];
  const endpoint: RunnerEndpoint = {
    name: "runner",
    revision,
    bind: vi.fn(),
    unbind: vi.fn(),
    sendInput: () => false,
    sendResize: () => false,
    request: (build) => {
      frames.push(build("request"));
      return Promise.resolve();
    },
  };
  const runtime = new RemoteAgentRuntime(
    agent,
    communication,
    { acquire: () => Promise.resolve(endpoint) },
    {
      settings: { askTimeoutMs: 1000, usageFlushMs: 0 },
      stopWaitMs: 100,
      resolveSecret,
    },
  );
  return { runtime, frames, resolveSecret };
}

describe("chave de API por agente no runner", () => {
  it("entrega o segredo apenas no início e mantém só a referência no grafo", async () => {
    const { runtime, frames, resolveSecret } = setup(3);
    await runtime.start("instruções");
    expect(resolveSecret).toHaveBeenCalledWith("claude-projeto");
    expect(frames[0]).toMatchObject({
      type: "agent.start",
      credentials: { apiKey: "credencial-ficticia" },
    });
    expect(JSON.stringify(agent)).not.toContain("credencial-ficticia");
    await runtime.deliver({
      id: "m",
      from: "@human",
      body: "trabalhe",
      kind: "message",
      replyTo: null,
    });
    await runtime.stop();
    expect(JSON.stringify(frames.slice(1))).not.toContain("credencial-ficticia");
  });

  it("recusa runner antigo antes de buscar ou enviar a chave", async () => {
    const { runtime, frames, resolveSecret } = setup(2);
    await expect(runtime.start("instruções")).rejects.toThrow("Atualize o runner");
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(frames).toEqual([]);
    expect(runtime.state).toBe("failed");
  });

  it("não substitui uma chave ausente pela assinatura do usuário", async () => {
    const resolveSecret = vi.fn().mockRejectedValue(new Error("Chave não encontrada"));
    const { runtime, frames } = setup(3, resolveSecret);
    await expect(runtime.start("instruções")).rejects.toThrow("Chave não encontrada");
    expect(frames).toEqual([]);
  });
});
