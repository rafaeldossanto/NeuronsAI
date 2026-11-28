import { canEditGraph, canReadDraft } from "../accounts/graph-access.js";
import { GraphAccessService } from "../accounts/graph-access.service.js";
import { RequirePermission } from "../accounts/require-permission.js";
import { Controller, Inject } from "@nestjs/common";
import { toIso, toIsoOrNull } from "../api/common-schemas.js";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import { HooksServer } from "./hooks-server.js";
import {
  type SetEnabledBody,
  type TriggerParams,
  setEnabledBody,
  triggerParams,
  triggerSecretSchema,
  triggerStateSchema,
} from "./triggers.contract.js";
import { type TriggerView, TriggersService } from "./triggers.service.js";

/** Shares the `graphs` prefix: a trigger belongs to a graph. Handler names must stay unique across both (operationId). */
@Controller("graphs")
export class TriggersController {
  constructor(
    @Inject(TriggersService) private readonly triggers: TriggersService,
    @Inject(HooksServer) private readonly hooks: HooksServer,
    @Inject(GraphAccessService) private readonly access: GraphAccessService,
  ) {}

  @Endpoint({
    method: "get",
    path: ":id/triggers/:triggerId",
    summary:
      "Mostra o estado de um gatilho externo: ativo, rota do webhook, se tem segredo, última e próxima execução.",
    params: triggerParams,
    response: triggerStateSchema,
    errors: [404],
  })
  async getTrigger(@ValidParams() { id, triggerId }: TriggerParams) {
    // Triggers are part of the project's setup: who only uses the project does not see them.
    await this.access.require(id, canReadDraft);
    return this.present(await this.triggers.get(id, triggerId));
  }

  @Endpoint({
    method: "post",
    path: ":id/triggers/:triggerId/secret",
    summary:
      "Gera o segredo do webhook (ou troca o atual, que deixa de valer na hora). O segredo só aparece nesta resposta.",
    params: triggerParams,
    response: triggerSecretSchema,
    status: 201,
    errors: [404, 503],
  })
  @RequirePermission("manage_credentials")
  async rotateTriggerSecret(@ValidParams() { id, triggerId }: TriggerParams) {
    await this.access.require(id, canEditGraph);
    const { secret, view } = await this.triggers.rotateSecret(id, triggerId);
    return { secret, state: this.present(view) };
  }

  @Endpoint({
    method: "put",
    path: ":id/triggers/:triggerId/enabled",
    summary:
      "Ativa ou desativa o gatilho. Ativar exige o gatilho na versão publicada mais recente (e o segredo, no webhook).",
    params: triggerParams,
    body: setEnabledBody,
    response: triggerStateSchema,
    errors: [404, 409],
  })
  @RequirePermission("write")
  async setTriggerEnabled(
    @ValidParams() { id, triggerId }: TriggerParams,
    @ValidBody() body: SetEnabledBody,
  ) {
    await this.access.require(id, canEditGraph);
    return this.present(await this.triggers.setEnabled(id, triggerId, body.enabled));
  }

  private present(view: TriggerView) {
    return {
      triggerId: view.triggerId,
      enabled: view.enabled,
      hookPath: view.hookId === null ? null : `/hooks/${view.hookId}`,
      hooksPort: this.hooks.port ?? null,
      hasSecret: view.secretSetAt !== null,
      secretSetAt: toIsoOrNull(view.secretSetAt),
      lastRun:
        view.lastFiredAt && view.lastOutcome
          ? {
              at: toIso(view.lastFiredAt),
              outcome: view.lastOutcome,
              note: view.lastNote,
              runId: view.lastRunId,
            }
          : null,
      nextRunAt: toIsoOrNull(view.nextRunAt),
    };
  }
}
