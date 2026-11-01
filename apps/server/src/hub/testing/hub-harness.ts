import type { GraphDefinition } from "@neurons/graph-schema";
import type { GraphVersionRepository } from "../../graphs/graph-version-repository.js";
import { InMemoryGraphVersionRepository } from "../../graphs/testing/in-memory-graph-repositories.js";
import {
  FakeAgentRuntimeFactory,
  type FakeRuntimeOptions,
  type FakeScript,
} from "../../agents/testing/fake-agent-runtime.js";
import type { RunEvent } from "../../realtime/run-event.js";
import type { RunEventLog } from "../../run-log/run-event-log.js";
import type { RunEventPublisher } from "../../run-log/run-event-publisher.js";
import { RunEventRecorder } from "../../run-log/run-event-recorder.js";
import type { RunRepository } from "../../run-log/run-repository.js";
import { InMemoryRunLog } from "../../run-log/testing/in-memory-run-log.js";
import { RunService } from "../../runs/run.service.js";
import { Hub, type HubOptions } from "../hub.js";
import type { MessageStore } from "../message-store.js";
import { MessagePolicyChain, type MessagePolicy } from "../message-policy.js";
import { PermissionPolicy } from "../permission-policy.js";
import { RunRegistry } from "../run-registry.js";
import { Supervisor } from "../supervisor.js";
import { InMemoryMessageStore } from "./in-memory-message-store.js";
import { buildTestGraph } from "./test-graph.js";

/** The storage side of the Hub: in memory for unit tests, Postgres for integration tests. */
export interface HubPersistence {
  messageStore: MessageStore;
  eventLog: RunEventLog;
  runs: RunRepository;
  versions: GraphVersionRepository;
}

export function inMemoryPersistence(): HubPersistence & {
  messageStore: InMemoryMessageStore;
  /** The same object as `eventLog` and `runs`. */
  runLog: InMemoryRunLog;
  versions: InMemoryGraphVersionRepository;
} {
  const versions = new InMemoryGraphVersionRepository();
  const runLog = new InMemoryRunLog(versions);
  return {
    versions,
    runLog,
    eventLog: runLog,
    runs: runLog,
    messageStore: new InMemoryMessageStore(runLog),
  };
}

export interface HubHarnessOptions {
  scripts?: Record<string, FakeScript>;
  runtimeOptions?: Record<string, FakeRuntimeOptions>;
  hub?: Partial<HubOptions>;
  extraPolicies?: MessagePolicy[];
}

/** Wires a Hub, Supervisor and RunService (fake runtimes) over the given storage, like the Nest module does. */
export function createHubHarness(persistence: HubPersistence, options: HubHarnessOptions = {}) {
  const published: RunEvent[] = [];
  const publisher: RunEventPublisher = { publish: (event) => void published.push(event) };
  const recorder = new RunEventRecorder(persistence.eventLog, publisher);
  const registry = new RunRegistry();
  const policies = new MessagePolicyChain([
    new PermissionPolicy(),
    ...(options.extraPolicies ?? []),
  ]);
  const hub = new Hub(persistence.messageStore, registry, policies, recorder, {
    askTimeoutMs: 120_000,
    ...options.hub,
  });
  const runtimes = new FakeAgentRuntimeFactory(options.scripts, options.runtimeOptions);
  const supervisor = new Supervisor(hub, runtimes, registry, persistence.runs, recorder);
  // Created on demand: its quiescence check would end the runs that hub-level tests drive by hand.
  let runService: RunService | undefined;
  return {
    hub,
    supervisor,
    runtimes,
    registry,
    recorder,
    published,
    get runService(): RunService {
      runService ??= new RunService(
        persistence.runs,
        persistence.versions,
        registry,
        hub,
        supervisor,
        recorder,
      );
      return runService;
    },
    /** Opens a run without sending anything, so tests can drive the Hub by hand. */
    async openRun(
      graph: GraphDefinition = buildTestGraph(),
      graphVersionId?: string,
    ): Promise<string> {
      const versionId =
        graphVersionId ?? (await persistence.versions.appendNext(graph.id, graph)).id;
      const { record } = await persistence.runs.createRunning(versionId, () => []);
      registry.register(record.id, graph);
      return record.id;
    },
  };
}
