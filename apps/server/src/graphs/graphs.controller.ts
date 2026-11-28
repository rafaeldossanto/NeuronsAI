import { Controller, Inject } from "@nestjs/common";
import { GraphAccessAdminService } from "../accounts/graph-access-admin.service.js";
import { canEditGraph, canSeeGraph } from "../accounts/graph-access.js";
import { GraphAccessService } from "../accounts/graph-access.service.js";
import { RequirePermission } from "../accounts/require-permission.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import { GraphDeletionService } from "./graph-deletion.service.js";
import type { GraphRecord } from "./graph.records.js";
import { GraphService } from "./graph.service.js";
import {
  type CreateGraphBody,
  type GraphParams,
  type GraphAccessUserParams,
  type GraphVersionParams,
  type PublishVersionBody,
  type SetGraphAccessBody,
  type SetGraphAccessModeBody,
  type UpdateGraphBody,
  createGraphBody,
  graphAccessRequestSchema,
  graphAccessSchema,
  graphAccessUserParams,
  graphDeletionRequestSchema,
  graphListSchema,
  graphParams,
  graphSchema,
  graphVersionListSchema,
  graphVersionParams,
  graphVersionSchema,
  publishVersionBody,
  setGraphAccessBody,
  setGraphAccessModeBody,
  updateGraphBody,
} from "./graphs.contract.js";
import {
  presentDeletionRequest,
  presentGraphAccess,
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
    @Inject(GraphAccessService) private readonly access: GraphAccessService,
    @Inject(GraphAccessAdminService) private readonly accessAdmin: GraphAccessAdminService,
  ) {}

  /** How the project looks to the caller (mode, owner, their level, requests). */
  private async viewOf(graph: GraphRecord) {
    return (await this.access.describe([graph])).get(graph.id)!;
  }

  @Endpoint({
    method: "get",
    path: "",
    summary:
      "Lista os grafos, com o pedido de exclusão pendente (se houver) e o acesso de quem pede: modo, dono, nível e pedidos de acesso. Um projeto sem acesso aparece só com nome e metadados.",
    response: graphListSchema,
  })
  async list() {
    const [graphs, pending] = await Promise.all([
      this.graphs.list(),
      this.deletions.pendingByGraph(),
    ]);
    const views = await this.access.describe(graphs);
    return {
      items: graphs.map((graph) =>
        presentGraphSummary(graph, views.get(graph.id)!, pending.get(graph.id)),
      ),
    };
  }

  @Endpoint({
    method: "post",
    path: "",
    summary:
      "Cria um grafo (com rascunho opcional). Com conta, quem cria é o dono e o projeto nasce restrito.",
    body: createGraphBody,
    response: graphSchema,
    status: 201,
  })
  async create(@ValidBody() body: CreateGraphBody) {
    // Only a signed-in person owns a project; the local workspace has no owner and no restriction.
    const { userId } = resourceScope.current();
    const graph = await this.graphs.create({
      name: body.name,
      ...(body.draft !== undefined && { draft: body.draft }),
      ...(userId && { ownerUserId: userId, accessMode: "restricted" as const }),
    });
    return presentGraph({ graph, latestVersion: null }, await this.viewOf(graph));
  }

  @Endpoint({
    method: "get",
    path: ":id",
    summary:
      "Mostra um grafo, com o rascunho (quem só usa o projeto recebe o rascunho nulo). 404 sem acesso.",
    params: graphParams,
    response: graphSchema,
    errors: [404],
  })
  async get(@ValidParams() { id }: GraphParams) {
    await this.access.require(id, canSeeGraph);
    const found = await this.graphs.get(id);
    return presentGraph(found, await this.viewOf(found.graph));
  }

  @Endpoint({
    method: "patch",
    path: ":id",
    summary: "Renomeia o grafo e/ou salva o rascunho. Exige poder editar o projeto.",
    params: graphParams,
    body: updateGraphBody,
    response: graphSchema,
    errors: [404],
  })
  async update(@ValidParams() { id }: GraphParams, @ValidBody() body: UpdateGraphBody) {
    await this.access.require(id, canEditGraph);
    const updated = await this.graphs.update(id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.draft !== undefined && { draft: body.draft }),
    });
    return presentGraph(updated, await this.viewOf(updated.graph));
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
    await this.access.require(id, canSeeGraph);
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
    await this.access.require(id, canSeeGraph);
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
    await this.access.require(id, canSeeGraph);
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
    await this.access.require(id, canEditGraph);
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
    await this.access.require(id, canSeeGraph);
    return presentVersion(await this.graphs.getVersion(id, version));
  }

  @Endpoint({
    method: "get",
    path: ":id/access",
    summary:
      "Quem acessa o projeto: o modo, o dono e as pessoas liberadas, bloqueadas ou com pedido pendente. Só quem gerencia o acesso (dono do projeto, proprietários e administradores); os outros recebem 404.",
    params: graphParams,
    response: graphAccessSchema,
    errors: [404],
  })
  async getAccess(@ValidParams() { id }: GraphParams) {
    return presentGraphAccess(await this.accessAdmin.details(id));
  }

  @Endpoint({
    method: "put",
    path: ":id/access/mode",
    summary:
      "Muda o modo: restrito (só o dono, proprietários e administradores e quem for liberado) ou aberto à organização (cada membro com o acesso do seu papel; bloqueados continuam sem acesso).",
    params: graphParams,
    body: setGraphAccessModeBody,
    response: graphAccessSchema,
    errors: [404],
  })
  async setAccessMode(
    @ValidParams() { id }: GraphParams,
    @ValidBody() body: SetGraphAccessModeBody,
  ) {
    await this.accessAdmin.setMode(id, body.mode);
    return presentGraphAccess(await this.accessAdmin.details(id));
  }

  @Endpoint({
    method: "put",
    path: ":id/access/:userId",
    summary:
      "Libera uma pessoa da organização como use (roda e vê as próprias execuções) ou edit (edita), o que também aprova o pedido dela; ou a bloqueia (sem acesso e sem poder pedir de novo). O dono, os proprietários e os administradores não podem ser limitados.",
    params: graphAccessUserParams,
    body: setGraphAccessBody,
    response: graphAccessSchema,
    errors: [404, 409],
  })
  async setAccess(
    @ValidParams() { id, userId }: GraphAccessUserParams,
    @ValidBody() body: SetGraphAccessBody,
  ) {
    if (body.status === "granted") await this.accessAdmin.grant(id, userId, body.level!);
    else await this.accessAdmin.block(id, userId);
    return presentGraphAccess(await this.accessAdmin.details(id));
  }

  @Endpoint({
    method: "delete",
    path: ":id/access/:userId",
    summary:
      "Tira a liberação ou o bloqueio de uma pessoa, ou recusa o pedido dela (o pedido some e ela pode pedir de novo).",
    params: graphAccessUserParams,
    status: 204,
    errors: [404],
  })
  async removeAccess(@ValidParams() { id, userId }: GraphAccessUserParams): Promise<void> {
    await this.accessAdmin.remove(id, userId);
  }

  @Endpoint({
    method: "post",
    path: ":id/access-request",
    summary:
      "Quem não tem acesso pede para entrar; o dono aprova escolhendo o nível, ou recusa. Um pedido por pessoa; quem foi bloqueado não pode pedir.",
    params: graphParams,
    response: graphAccessRequestSchema,
    status: 201,
    errors: [403, 404, 409],
  })
  @RequirePermission("read")
  async requestAccess(@ValidParams() { id }: GraphParams) {
    return { requestedAt: (await this.accessAdmin.request(id)).requestedAt.toISOString() };
  }

  @Endpoint({
    method: "delete",
    path: ":id/access-request",
    summary: "Quem pediu acesso cancela o próprio pedido.",
    params: graphParams,
    status: 204,
    errors: [404, 409],
  })
  @RequirePermission("read")
  async cancelAccessRequest(@ValidParams() { id }: GraphParams): Promise<void> {
    await this.accessAdmin.cancelRequest(id);
  }
}
