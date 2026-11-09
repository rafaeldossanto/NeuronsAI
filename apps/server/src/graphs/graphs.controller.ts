import { Controller, Inject } from "@nestjs/common";
import { RequirePermission } from "../accounts/require-permission.js";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import { GraphService } from "./graph.service.js";
import {
  type CreateGraphBody,
  type GraphParams,
  type GraphVersionParams,
  type PublishVersionBody,
  type UpdateGraphBody,
  createGraphBody,
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
  presentGraph,
  presentGraphSummary,
  presentVersion,
  presentVersionSummary,
} from "./graphs.presenters.js";

@RequirePermission("write")
@Controller("graphs")
export class GraphsController {
  constructor(@Inject(GraphService) private readonly graphs: GraphService) {}

  @Endpoint({
    method: "get",
    path: "",
    summary: "Lista os grafos.",
    response: graphListSchema,
  })
  async list() {
    return { items: (await this.graphs.list()).map(presentGraphSummary) };
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
    summary: "Apaga um grafo que ainda não tem versões publicadas.",
    params: graphParams,
    status: 204,
    errors: [404, 409],
  })
  async remove(@ValidParams() { id }: GraphParams): Promise<void> {
    await this.graphs.remove(id);
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
