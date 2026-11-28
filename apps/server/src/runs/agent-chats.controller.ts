import { Controller, Inject } from "@nestjs/common";
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
  constructor(@Inject(AgentChatsService) private readonly chats: AgentChatsService) {}

  @Endpoint({
    method: "get",
    path: ":id/agent-chats/:agentId/turns",
    summary: "Lista os turnos do chat de um agente, dos mais recentes aos mais antigos.",
    params: agentChatParams,
    query: agentChatQuery,
    response: chatTurnListSchema,
    errors: [404],
  })
  listAgentChatTurns(
    @ValidParams() { id, agentId }: AgentChatParams,
    @ValidQuery() query: AgentChatQuery,
  ) {
    return this.chats.list(id, agentId, query);
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
    const run = await this.chats.send(id, agentId, body);
    return { runId: run.id };
  }
}
