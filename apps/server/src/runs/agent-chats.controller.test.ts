import { describe, expect, it, vi } from "vitest";
import { GraphAccessService } from "../accounts/graph-access.service.js";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import { AgentChatsController } from "./agent-chats.controller.js";
import type { AgentChatsService } from "./agent-chats.service.js";

const params = { id: "00000000-0000-4000-8000-0000000000a1", agentId: "agente-alfa" };
const query = { limit: 20, offset: 0 };
const person = "00000000-0000-4000-8000-000000000001";

describe("AgentChatsController: acesso ao projeto", () => {
  const build = (access: Partial<Record<keyof GraphAccessService, unknown>>) => {
    const list = vi.fn(() => Promise.resolve({ items: [], hasMore: false }));
    const send = vi.fn(() => Promise.resolve({ id: "run-1" }));
    const controller = new AgentChatsController(
      { list, send } as unknown as AgentChatsService,
      access as unknown as GraphAccessService,
    );
    return { controller, list, send };
  };

  it("lista todos os turnos de quem alcança todas as execuções", async () => {
    const { controller, list } = build({ requireRunReach: vi.fn(() => ({ reach: "all" })) });
    await controller.listAgentChatTurns(params, query);
    expect(list).toHaveBeenCalledWith(params.id, params.agentId, query, undefined);
  });

  it("limita a lista aos turnos da própria pessoa quando ela só alcança as suas execuções", async () => {
    const { controller, list } = build({
      requireRunReach: vi.fn(() => ({ reach: "own", userId: person })),
    });
    await controller.listAgentChatTurns(params, query);
    expect(list).toHaveBeenCalledWith(params.id, params.agentId, query, person);
  });

  it("não lista nada de um projeto que a pessoa não alcança", async () => {
    const { controller, list } = build({
      requireRunReach: vi.fn(() => Promise.reject(new GraphNotFoundError(params.id))),
    });
    await expect(controller.listAgentChatTurns(params, query)).rejects.toBeInstanceOf(
      GraphNotFoundError,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("só envia a mensagem de quem pode rodar o projeto (use ou mais)", async () => {
    const require = vi.fn((_id: string, check: (level: string) => boolean) => {
      if (!check("view")) return Promise.reject(new GraphNotFoundError(params.id));
      return Promise.resolve("view");
    });
    const { controller, send } = build({ require });
    await expect(controller.sendAgentChatTurn(params, { body: "oi" })).rejects.toBeInstanceOf(
      GraphNotFoundError,
    );
    expect(send).not.toHaveBeenCalled();

    const allowed = build({ require: vi.fn(() => Promise.resolve("use")) });
    await expect(allowed.controller.sendAgentChatTurn(params, { body: "oi" })).resolves.toEqual({
      runId: "run-1",
    });
    expect(allowed.send).toHaveBeenCalledOnce();
  });

  it("confere o nível com canRunGraph: use, edit e manage passam; view e none não", async () => {
    let check: ((level: never) => boolean) | undefined;
    const { controller } = build({
      require: vi.fn((_id: string, fn: (level: never) => boolean) => {
        check = fn;
        return Promise.resolve("use");
      }),
    });
    await controller.sendAgentChatTurn(params, { body: "oi" });
    const verdicts = ["manage", "edit", "use", "view", "none"].map((level) =>
      check!(level as never),
    );
    expect(verdicts).toEqual([true, true, true, false, false]);
  });
});
