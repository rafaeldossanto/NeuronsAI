import { Controller, Inject } from "@nestjs/common";
import { RequirePermission } from "../accounts/require-permission.js";
import { Endpoint, ValidBody, ValidParams, ValidQuery } from "../api/endpoint.js";
import { HUMAN } from "../hub/addresses.js";
import { Hub } from "../hub/hub.js";
import { RunQueryService } from "./run-query.service.js";
import { RunService } from "./run.service.js";
import {
  type EventsQuery,
  type ListRunsQuery,
  type MessagesQuery,
  type RunParams,
  type SendMessageBody,
  type StartRunBody,
  eventsQuery,
  listRunsQuery,
  messageListSchema,
  messageSchema,
  messagesQuery,
  runDetailSchema,
  runEventListSchema,
  runListSchema,
  runParams,
  sendMessageBody,
  startRunBody,
} from "./runs.contract.js";
import {
  presentMessage,
  presentRunDetail,
  presentRunEvent,
  presentRunListItem,
} from "./runs.presenters.js";

@RequirePermission("write")
@Controller("runs")
export class RunsController {
  constructor(
    @Inject(RunService) private readonly runs: RunService,
    @Inject(RunQueryService) private readonly queries: RunQueryService,
    @Inject(Hub) private readonly hub: Hub,
  ) {}

  @Endpoint({
    method: "post",
    path: "",
    summary: "Inicia uma execução de uma versão publicada do grafo.",
    body: startRunBody,
    response: runDetailSchema,
    status: 201,
    errors: [404, 429],
  })
  async start(@ValidBody() body: StartRunBody) {
    const run = await this.runs.start(body.graphVersionId, body.input, {
      ...(body.triggerId !== undefined && { triggerId: body.triggerId }),
      ...(body.budgetUsd !== undefined && { budgetUsd: body.budgetUsd }),
    });
    return presentRunDetail(await this.queries.detail(run.id));
  }

  @Endpoint({
    method: "get",
    path: "",
    summary:
      "Lista as execuções com filtros e paginação (offset); das mais novas para as mais antigas por padrão.",
    query: listRunsQuery,
    response: runListSchema,
  })
  async list(@ValidQuery() query: ListRunsQuery) {
    const page = await this.queries.list({
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      order: query.order,
      ...(query.status !== undefined && { status: query.status }),
      ...(query.graphId !== undefined && { graphId: query.graphId }),
      ...(query.graphVersionId !== undefined && { graphVersionId: query.graphVersionId }),
      ...(query.minCostUsd !== undefined && { minCostUsd: query.minCostUsd }),
      ...(query.maxCostUsd !== undefined && { maxCostUsd: query.maxCostUsd }),
      ...(query.from !== undefined && { from: new Date(query.from) }),
      ...(query.to !== undefined && { to: new Date(query.to) }),
    });
    return {
      items: page.items.map(presentRunListItem),
      total: page.total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Endpoint({
    method: "get",
    path: ":id",
    summary: "Mostra uma execução: estado, motivo do fim e consumo.",
    params: runParams,
    response: runDetailSchema,
    errors: [404],
  })
  async get(@ValidParams() { id }: RunParams) {
    return presentRunDetail(await this.queries.detail(id));
  }

  @Endpoint({
    method: "post",
    path: ":id/stop",
    summary: "Para a execução: encerra os runtimes e os terminais dos agentes.",
    params: runParams,
    response: runDetailSchema,
    errors: [404],
  })
  async stop(@ValidParams() { id }: RunParams) {
    await this.queries.require(id);
    await this.runs.stop(id);
    return presentRunDetail(await this.queries.detail(id));
  }

  @Endpoint({
    method: "post",
    path: ":id/messages",
    summary: "Manda uma mensagem, como você (@human), a qualquer agente da execução.",
    params: runParams,
    body: sendMessageBody,
    response: messageSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  async sendMessage(@ValidParams() { id }: RunParams, @ValidBody() body: SendMessageBody) {
    await this.queries.require(id);
    return presentMessage(await this.hub.send(id, HUMAN, body.to, "message", body.body));
  }

  @Endpoint({
    method: "get",
    path: ":id/messages",
    summary: "Lista as mensagens da execução, em ordem.",
    params: runParams,
    query: messagesQuery,
    response: messageListSchema,
    errors: [404],
  })
  async messages(@ValidParams() { id }: RunParams, @ValidQuery() query: MessagesQuery) {
    const messages = await this.queries.messagesOf(id, query.afterSeq, query.limit);
    return { items: messages.map(presentMessage) };
  }

  @Endpoint({
    method: "get",
    path: ":id/events",
    summary:
      "Lista os eventos da execução, em ordem (o mesmo log que o WebSocket transmite), com o total.",
    params: runParams,
    query: eventsQuery,
    response: runEventListSchema,
    errors: [404],
  })
  async events(@ValidParams() { id }: RunParams, @ValidQuery() query: EventsQuery) {
    const events = await this.queries.events(id, query.fromSeq, query.limit);
    return { items: events.map(presentRunEvent), total: await this.queries.eventCount(id) };
  }
}
