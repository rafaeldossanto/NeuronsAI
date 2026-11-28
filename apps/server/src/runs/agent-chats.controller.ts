import { Controller, Inject } from "@nestjs/common";
import { canRunGraph } from "../accounts/graph-access.js";
import { GraphAccessService } from "../accounts/graph-access.service.js";
import { RequirePermission } from "../accounts/require-permission.js";
import { Endpoint, ValidBody, ValidParams, ValidQuery } from "../api/endpoint.js";
import {
  agentChatParams,
  agentChatQuery,
  chatTurnListSchema,
  chatTurnStartedSchema,
  sendChatTurnBody,
  type AgentChatParams,
  type AgentChatQuery,
  type SendChatTurnBody,
} from "./agent-chat.contract.js";
import { AgentChatsService } from "./agent-chats.service.js";

@RequirePermission("write")
@Controller("graphs")
export class AgentChatsController {
  constructor(
    @Inject(AgentChatsService) private readonly chats: AgentChatsService,
    @Inject(GraphAccessService) private readonly access: GraphAccessService,
  ) {}

  @Endpoint({
    method: "get",
    path: ":id/agent-chats/:agentId/turns",
    summary: "Lista os turnos do chat de um agente, dos mais recentes aos mais antigos.",
    params: agentChatParams,
    query: agentChatQuery,
    response: chatTurnListSchema,
    errors: [404],
  })
  async listAgentChatTurns(
    @ValidParams() { id, agentId }: AgentChatParams,
    @ValidQuery() query: AgentChatQuery,
  ) {
    // The turns are runs: the person reads the same ones they read in the run list.
    const scope = await this.access.requireRunReach(id);
    return this.chats.list(id, agentId, query, scope.reach === "own" ? scope.userId : undefined);
  }

  @Endpoint({
    method: "post",
    path: ":id/agent-chats/:agentId/turns",
    summary: "Envia uma mensagem diretamente ao agente usando a versão publicada do fluxo.",
    params: agentChatParams,
    body: sendChatTurnBody,
    response: chatTurnStartedSchema,
    status: 201,
    errors: [403, 404, 409, 413, 429],
  })
  async sendAgentChatTurn(
    @ValidParams() { id, agentId }: AgentChatParams,
    @ValidBody() body: SendChatTurnBody,
  ) {
    // Talking to an agent starts a run: it needs the same access as running the project.
    await this.access.require(id, canRunGraph);
    const run = await this.chats.send(id, agentId, body);
    return { runId: run.id };
  }
}
