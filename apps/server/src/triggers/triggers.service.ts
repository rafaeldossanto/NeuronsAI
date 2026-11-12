import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { GRAPH_REPOSITORY, type GraphRepository } from "../graphs/graph-repository.js";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import { SecretsService } from "../secrets/secrets.service.js";
import { TriggerLauncher } from "./trigger-launcher.js";
import { webhookSecretName } from "./webhook-secret-name.js";
import {
  TRIGGER_STATE_REPOSITORY,
  type TriggerStateRecord,
  type TriggerStateRepository,
} from "./trigger-state.js";
import {
  WebhookSecretRequiredError,
  WhatsAppAppSecretMissingError,
  WhatsAppVerifyTokenRequiredError,
} from "./triggers.errors.js";

export type TriggerChangeListener = (change: {
  graphId: string;
  triggerId: string;
}) => Promise<void>;

export { webhookSecretName };

/** A trigger's state as the API shows it; a trigger nobody touched yet is all defaults. */
export type TriggerView = Pick<
  TriggerStateRecord,
  | "triggerId"
  | "enabled"
  | "secretSetAt"
  | "lastFiredAt"
  | "lastOutcome"
  | "lastNote"
  | "lastRunId"
  | "nextRunAt"
> & { hookId: string | null };

/**
 * Managing external triggers: the webhook secret and turning a trigger on or off. What fires them
 * is the {@link WebhookService} and the scheduler, which listen to {@link changed}.
 */
@Injectable()
export class TriggersService {
  private readonly listeners: TriggerChangeListener[] = [];

  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphs: GraphRepository,
    @Inject(TRIGGER_STATE_REPOSITORY) private readonly states: TriggerStateRepository,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(TriggerLauncher) private readonly launcher: TriggerLauncher,
  ) {}

  /**
   * Called, and waited for, after a trigger is turned on or off: the scheduler follows, so the
   * answer already carries the next moment.
   */
  onChange(listener: TriggerChangeListener): void {
    this.listeners.push(listener);
  }

  async get(graphId: string, triggerId: string): Promise<TriggerView> {
    await this.requireGraph(graphId);
    const state = await this.states.find(graphId, triggerId);
    return state ? viewOf(state) : emptyView(triggerId);
  }

  /**
   * Generates the webhook's secret (the first one, or a new one that replaces it; the old one stops
   * working at once). The secret is returned here and nowhere else: only a cipher of it is kept.
   * For a WhatsApp trigger (by the saved draft) the secret is the **verify token** that Meta sends
   * back when it confirms the URL; the App Secret is the user's own, kept under a name of their
   * choosing.
   */
  async rotateSecret(
    graphId: string,
    triggerId: string,
  ): Promise<{ secret: string; view: TriggerView }> {
    const graph = await this.requireGraph(graphId);
    const existing = await this.states.find(graphId, triggerId);
    const hookId = existing?.hookId ?? newHookId();
    const isWhatsApp = draftTriggerKind(graph.draft, triggerId) === "whatsapp";
    const secret = `${isWhatsApp ? "vt_" : "whsec_"}${randomBytes(32).toString("base64url")}`;
    // Stored first: without a master key nothing is created.
    await this.secrets.set(webhookSecretName(hookId), secret);
    await this.states.ensure(graphId, triggerId, hookId);
    await this.states.update(graphId, triggerId, { secretSetAt: new Date() });
    return { secret, view: await this.get(graphId, triggerId) };
  }

  /**
   * Turns the trigger on or off. Turning on needs the trigger to exist in the latest published
   * version as a webhook or a schedule (and a webhook needs its secret); the state is kept apart
   * from the graph so this never publishes a version.
   */
  async setEnabled(graphId: string, triggerId: string, enabled: boolean): Promise<TriggerView> {
    await this.requireGraph(graphId);
    const existing = await this.states.find(graphId, triggerId);
    if (enabled) await this.assertCanEnable(graphId, triggerId, existing);
    if (!existing && !enabled) return emptyView(triggerId);
    await this.states.ensure(graphId, triggerId, existing?.hookId ?? newHookId());
    await this.states.update(graphId, triggerId, {
      enabled,
      ...(!enabled && { nextRunAt: null }),
    });
    await Promise.all(this.listeners.map((listener) => listener({ graphId, triggerId })));
    return this.get(graphId, triggerId);
  }

  private async assertCanEnable(
    graphId: string,
    triggerId: string,
    existing: TriggerStateRecord | undefined,
  ): Promise<void> {
    // The kind decides what is needed: look at the published version, as the trigger will.
    const { trigger } = await this.launcher.resolve(graphId, triggerId);
    if (trigger.kind === "webhook" && !existing?.secretSetAt) {
      throw new WebhookSecretRequiredError();
    }
    if (trigger.kind === "whatsapp") {
      if (!existing?.secretSetAt) throw new WhatsAppVerifyTokenRequiredError();
      const appSecretName = trigger.appSecretName;
      if (
        appSecretName !== undefined &&
        !(await this.secrets.listNames()).includes(appSecretName)
      ) {
        throw new WhatsAppAppSecretMissingError(appSecretName);
      }
    }
  }

  private async requireGraph(graphId: string) {
    const graph = await this.graphs.findById(graphId);
    if (!graph) throw new GraphNotFoundError(graphId);
    return graph;
  }
}

const viewOf = (state: TriggerStateRecord): TriggerView => ({
  triggerId: state.triggerId,
  hookId: state.hookId,
  enabled: state.enabled,
  secretSetAt: state.secretSetAt,
  lastFiredAt: state.lastFiredAt,
  lastOutcome: state.lastOutcome,
  lastNote: state.lastNote,
  lastRunId: state.lastRunId,
  nextRunAt: state.nextRunAt,
});

const emptyView = (triggerId: string): TriggerView => ({
  triggerId,
  hookId: null,
  enabled: false,
  secretSetAt: null,
  lastFiredAt: null,
  lastOutcome: null,
  lastNote: null,
  lastRunId: null,
  nextRunAt: null,
});

/** The kind of the trigger in the saved draft, which is all the editor has before a publication. */
function draftTriggerKind(draft: unknown, triggerId: string): string | undefined {
  const nodes = (draft as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return undefined;
  const node = nodes.find(
    (candidate: unknown): candidate is { kind?: unknown } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === triggerId,
  );
  return typeof node?.kind === "string" ? node.kind : undefined;
}

/** 128 random bits, URL-safe: the public URL says nothing about the graph or the trigger. */
function newHookId(): string {
  return randomBytes(16).toString("base64url");
}
