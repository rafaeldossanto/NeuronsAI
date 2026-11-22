import { Controller, Inject } from "@nestjs/common";
import { RequirePermission } from "../accounts/require-permission.js";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import { GraphDeletionService } from "./graph-deletion.service.js";
import { GraphService } from "./graph.service.js";
import {
  type CreateGraphBody,
  type GraphParams,
  type GraphVersionParams,
  type PublishVersionBody,
  type UpdateGraphBody,
  createGraphBody,
  graphDeletionRequestSchema,
  graphListSchema,
  graphParams,
  graphSchema,
  graphVersionListSchema,
  graphVersionParams,
  graphVersionSchema,
  publishVersionBody,
  updateGraphBody,
} from "./graphs.contract.js";
import {
  presentDeletionRequest,
  presentGraph,
  presentGraphSummary,
  presentVersion,
  presentVersionSummary,
} from "./graphs.presenters.js";

@RequirePermission("write")
@Controller("graphs")
export class GraphsController {
  constructor(
    @Inject(GraphService) private readonly graphs: GraphService,
    @Inject(GraphDeletionService) private readonly deletions: GraphDeletionService,
  ) {}

  @Endpoint({
    method: "get",
    path: "",
    summary: "Lista os grafos, com o pedido de exclusão pendente de cada um (se houver).",
    response: graphListSchema,
  })
  async list() {
    const [graphs, pending] = await Promise.all([
      this.graphs.list(),
      this.deletions.pendingByGraph(),
    ]);
    return { items: graphs.map((graph) => presentGraphSummary(graph, pending.get(graph.id))) };
  }

  @Endpoint({
    method: "post",
    path: "",
    summary: "Cria um grafo (com rascunho opcional).",
    body: createGraphBody,
    response: graphSchema,
    status: 201,
  })
  async create(@ValidBody() body: CreateGraphBody) {
    const graph = await this.graphs.create({
      name: body.name,
      ...(body.draft !== undefined && { draft: body.draft }),
    });
    return presentGraph({ graph, latestVersion: null });
  }

  @Endpoint({
    method: "get",
    path: ":id",
    summary: "Mostra um grafo, com o rascunho.",
    params: graphParams,
    response: graphSchema,
    errors: [404],
  })
  async get(@ValidParams() { id }: GraphParams) {
    return presentGraph(await this.graphs.get(id));
  }

  @Endpoint({
    method: "patch",
    path: ":id",
    summary: "Renomeia o grafo e/ou salva o rascunho.",
    params: graphParams,
    body: updateGraphBody,
    response: graphSchema,
    errors: [404],
  })
  async update(@ValidParams() { id }: GraphParams, @ValidBody() body: UpdateGraphBody) {
    return presentGraph(
      await this.graphs.update(id, {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.draft !== undefined && { draft: body.draft }),
      }),
    );
  }

  @Endpoint({
    method: "delete",
    path: ":id",
    summary:
      "Apaga o grafo com as versões publicadas, o histórico de execuções e os gatilhos. Recusa (409) se houver execução em andamento.",
    params: graphParams,
    status: 204,
    errors: [403, 404, 409],
  })
  @RequirePermission("delete_graphs")
  async remove(@ValidParams() { id }: GraphParams): Promise<void> {
    await this.graphs.remove(id);
  }

  @Endpoint({
    method: "post",
    path: ":id/deletion-request",
    summary:
      "Um membro pede a exclusão do projeto; um proprietário ou administrador aprova ou recusa. Só um pedido pendente por projeto.",
    params: graphParams,
    response: graphDeletionRequestSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  async requestDeletion(@ValidParams() { id }: GraphParams) {
    return presentDeletionRequest(await this.deletions.request(id));
  }

  @Endpoint({
    method: "delete",
    path: ":id/deletion-request",
    summary: "Quem pediu a exclusão cancela o pedido pendente.",
    params: graphParams,
    status: 204,
    errors: [403, 404, 409],
  })
  async cancelDeletionRequest(@ValidParams() { id }: GraphParams): Promise<void> {
    await this.deletions.cancel(id);
  }

  @Endpoint({
    method: "post",
    path: ":id/deletion-request/approve",
    summary:
      "Aprova o pedido: exclui o projeto como o DELETE. Com execução em andamento recusa (409) e o pedido continua pendente.",
    params: graphParams,
    status: 204,
    errors: [403, 404, 409],
  })
  @RequirePermission("delete_graphs")
  async approveDeletionRequest(@ValidParams() { id }: GraphParams): Promise<void> {
    await this.deletions.approve(id);
  }

  @Endpoint({
    method: "post",
    path: ":id/deletion-request/reject",
    summary: "Recusa o pedido de exclusão pendente; o projeto fica como está.",
    params: graphParams,
    status: 204,
    errors: [403, 404],
  })
  @RequirePermission("delete_graphs")
  async rejectDeletionRequest(@ValidParams() { id }: GraphParams): Promise<void> {
    await this.deletions.reject(id);
  }

  @Endpoint({
    method: "get",
    path: ":id/versions",
    summary: "Lista as versões publicadas do grafo, da mais antiga à mais nova.",
    params: graphParams,
    response: graphVersionListSchema,
    errors: [404],
  })
  async listVersions(@ValidParams() { id }: GraphParams) {
    return { items: (await this.graphs.listVersions(id)).map(presentVersionSummary) };
  }

  @Endpoint({
    method: "post",
    path: ":id/versions",
    summary: "Valida o grafo e congela uma nova versão (sem corpo, publica o rascunho).",
    params: graphParams,
    body: publishVersionBody,
    response: graphVersionSchema,
    status: 201,
    errors: [403, 404],
  })
  async publish(@ValidParams() { id }: GraphParams, @ValidBody() body: PublishVersionBody) {
    return presentVersion(await this.graphs.publish(id, body.definition));
  }

  @Endpoint({
    method: "get",
    path: ":id/versions/:version",
    summary: "Mostra uma versão publicada, com a definição congelada.",
    params: graphVersionParams,
    response: graphVersionSchema,
    errors: [404],
  })
  async getVersion(@ValidParams() { id, version }: GraphVersionParams) {
    return presentVersion(await this.graphs.getVersion(id, version));
  }
}
