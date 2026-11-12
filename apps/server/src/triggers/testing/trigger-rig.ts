import { randomBytes, randomUUID } from "node:crypto";
import type { GraphDefinition, TriggerNode } from "@neurons/graph-schema";
import { InMemoryGraphRepository } from "../../graphs/testing/in-memory-graph-repositories.js";
import { InMemoryGraphVersionRepository } from "../../graphs/testing/in-memory-graph-repositories.js";
import { GraphVersionService } from "../../graphs/graph-version.service.js";
import { buildTestGraph } from "../../hub/testing/test-graph.js";
import type { RunRecord, RunRepository } from "../../run-log/run-repository.js";
import { AesGcmSecretCipher } from "../../secrets/secret-cipher.js";
import { SecretsService } from "../../secrets/secrets.service.js";
import { InMemorySecretRepository } from "../../secrets/testing/in-memory-secret-repository.js";
import type { RunService } from "../../runs/run.service.js";
import { TriggerLauncher } from "../trigger-launcher.js";
import { TriggerScheduler } from "../trigger-scheduler.js";
import { TriggersService } from "../triggers.service.js";
import { WebhookService } from "../webhook.service.js";
import { WhatsAppService } from "../whatsapp.service.js";
import { InMemoryWhatsAppMessageRepository } from "./in-memory-whatsapp-message-repository.js";
import { InMemoryTriggerStateRepository } from "./in-memory-trigger-state-repository.js";

export const WEBHOOK_TRIGGER = "gatilho-webhook";
export const SCHEDULE_TRIGGER = "gatilho-agenda";
export const WHATSAPP_TRIGGER = "gatilho-whatsapp";
export const WHATSAPP_PHONE_NUMBER_ID = "106540352242922";
export const WHATSAPP_APP_SECRET_NAME = "whatsapp-app-secret";

const position = { x: 0, y: 0 };

/** The test graph with a webhook trigger and a schedule trigger, both pointing at Alfa. */
export function graphWithExternalTriggers(schedule: Partial<TriggerNode> = {}): GraphDefinition {
  const graph = buildTestGraph();
  const triggers: TriggerNode[] = [
    { id: WEBHOOK_TRIGGER, type: "trigger", position, kind: "webhook", target: "agente-alfa" },
    {
      id: SCHEDULE_TRIGGER,
      type: "trigger",
      position,
      kind: "schedule",
      target: "agente-alfa",
      cron: "* * * * *",
      timezone: "UTC",
      ...schedule,
    },
  ];
  return { ...graph, nodes: [...triggers, ...graph.nodes.filter((n) => n.type !== "trigger")] };
}

/** The test graph with a WhatsApp trigger that points at Alfa. */
export function graphWithWhatsApp(): GraphDefinition {
  const graph = buildTestGraph();
  const trigger: TriggerNode = {
    id: WHATSAPP_TRIGGER,
    type: "trigger",
    position,
    kind: "whatsapp",
    target: "agente-alfa",
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    appSecretName: WHATSAPP_APP_SECRET_NAME,
  };
  return { ...graph, nodes: [trigger, ...graph.nodes.filter((n) => n.type !== "trigger")] };
}

/** A RunService that only records what it was asked to start; runs stay `running` until finished. */
export class FakeRunService {
  readonly starts: { versionId: string; input: string; triggerId: string | undefined }[] = [];
  readonly records = new Map<string, RunRecord>();
  /** Makes the next `start` fail with this error. */
  failWith: Error | undefined;

  start(
    versionId: string,
    input: string,
    options: { triggerId?: string } = {},
  ): Promise<RunRecord> {
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = undefined;
      return Promise.reject(error);
    }
    this.starts.push({ versionId, input, triggerId: options.triggerId });
    const record: RunRecord = {
      id: randomUUID(),
      graphVersionId: versionId,
      status: "running",
      budgetUsd: null,
      startedAt: new Date(),
      finishedAt: null,
    };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  finish(runId: string): void {
    const record = this.records.get(runId);
    if (record) this.records.set(runId, { ...record, status: "succeeded", finishedAt: new Date() });
  }

  /** The slice of RunRepository the scheduler reads. */
  asRepository(): RunRepository {
    return { findById: (id: string) => Promise.resolve(this.records.get(id)) } as RunRepository;
  }
}

/** The trigger services over in-memory storage and a fake RunService: no Nest, no database. */
export async function createTriggerRig(options: { ratePerMinute?: number } = {}) {
  const graphs = new InMemoryGraphRepository();
  const versions = new InMemoryGraphVersionRepository();
  const states = new InMemoryTriggerStateRepository();
  const secretRepository = new InMemorySecretRepository();
  const secrets = new SecretsService(secretRepository, new AesGcmSecretCipher(randomBytes(32)));
  const runService = new FakeRunService();
  const launcher = new TriggerLauncher(versions, runService as unknown as RunService);
  const triggers = new TriggersService(graphs, states, secrets, launcher);
  const webhook = new WebhookService(states, secrets, launcher, {
    ratePerMinute: options.ratePerMinute ?? 1_000,
  });
  const whatsappMessages = new InMemoryWhatsAppMessageRepository();
  const whatsapp = new WhatsAppService(states, secrets, launcher, whatsappMessages, {
    ratePerMinute: options.ratePerMinute ?? 1_000,
  });
  const versionService = new GraphVersionService(graphs, versions);
  const graph = await graphs.create({ name: "Com gatilhos externos" });

  const publish = async (definition: GraphDefinition = graphWithExternalTriggers()) => {
    const result = await versionService.publish(graph.id, { ...definition, id: graph.id });
    if (!result.ok) throw new Error(`Grafo de teste inválido: ${JSON.stringify(result.issues)}`);
    return result.version;
  };

  const scheduler = (clock?: () => number) =>
    new TriggerScheduler(
      states,
      runService.asRepository(),
      launcher,
      triggers,
      versionService,
      clock,
    );

  return {
    graph,
    graphs,
    versions,
    versionService,
    states,
    secrets,
    secretRepository,
    runService,
    launcher,
    triggers,
    webhook,
    whatsapp,
    whatsappMessages,
    publish,
    scheduler,
  };
}
