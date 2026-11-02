import type { AgentRuntimeFactory } from "@neurons/agent-runtimes";
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
import { BudgetGuard } from "../../guards/budget-guard.js";
import { GuardEnforcer } from "../../guards/guard-enforcer.js";
import { guardPolicies } from "../../guards/guard-policies.js";
import { IdleWatchdog } from "../../guards/idle-watchdog.js";
import type { RunEventHistory } from "../../realtime/run-event-history.js";
import {
  DEFAULT_PING_PONG_MESSAGES,
  DEFAULT_RUN_MAX_MESSAGES,
  type GuardLimits,
} from "../../shared/config/guard-config.js";
import { MessagePolicyChain, type MessagePolicy } from "../message-policy.js";
import { PermissionPolicy } from "../permission-policy.js";
import { RunRegistry } from "../run-registry.js";
import { RunSubscriptions } from "../../realtime/run-subscriptions.js";
import { TerminalSessions } from "../../realtime/terminal-sessions.js";
import { Supervisor } from "../supervisor.js";
import { InMemoryMessageStore } from "./in-memory-message-store.js";
import { buildTestGraph } from "./test-graph.js";

/** The storage side of the Hub: in memory for unit tests, Postgres for integration tests. */
export interface HubPersistence {
  messageStore: MessageStore;
  eventLog: RunEventLog;
  history: RunEventHistory;
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
    history: runLog,
    runs: runLog,
    messageStore: new InMemoryMessageStore(runLog),
  };
}

export interface HubWiringOptions {
  hub?: Partial<HubOptions>;
  extraPolicies?: MessagePolicy[];
  /** Overrides the guard limits (the defaults are the server's). */
  limits?: Partial<GuardLimits>;
}

export interface HubHarnessOptions extends HubWiringOptions {
  scripts?: Record<string, FakeScript>;
  runtimeOptions?: Record<string, FakeRuntimeOptions>;
}

/** Wires a Hub, Supervisor and RunService over the given storage and runtime factory, like the Nest module does. */
export function createHubWiring(
  persistence: HubPersistence,
  factory: AgentRuntimeFactory,
  options: HubWiringOptions = {},
) {
  const published: RunEvent[] = [];
  const publisher: RunEventPublisher = { publish: (event) => void published.push(event) };
  const recorder = new RunEventRecorder(persistence.eventLog, publisher);
  const registry = new RunRegistry();
  const limits = {
    runMaxMessages: DEFAULT_RUN_MAX_MESSAGES,
    pingPongMessages: DEFAULT_PING_PONG_MESSAGES,
    ...options.limits,
  };
  const policies = new MessagePolicyChain([
    new PermissionPolicy(),
    ...guardPolicies(persistence.messageStore, limits),
    ...(options.extraPolicies ?? []),
  ]);
  const hub = new Hub(persistence.messageStore, registry, policies, recorder, {
    askTimeoutMs: 120_000,
    ...options.hub,
  });
  const terminals = new TerminalSessions(
    new RunSubscriptions({ readFrom: () => Promise.resolve([]) }),
  );
  const enforcer = new GuardEnforcer(hub, recorder);
  const supervisor = new Supervisor(
    hub,
    factory,
    registry,
    persistence.runs,
    recorder,
    terminals,
    enforcer,
  );
  const budgetGuard = new BudgetGuard(
    hub,
    supervisor,
    registry,
    enforcer,
    recorder,
    persistence.history,
  );
  const idleWatchdog = new IdleWatchdog(hub, supervisor, registry, enforcer);
  // Created on demand: its quiescence check would end the runs that hub-level tests drive by hand.
  let runService: RunService | undefined;
  return {
    hub,
    supervisor,
    registry,
    recorder,
    terminals,
    enforcer,
    budgetGuard,
    idleWatchdog,
    published,
    get runService(): RunService {
      runService ??= new RunService(
        persistence.runs,
        persistence.versions,
        registry,
        hub,
        supervisor,
        recorder,
        enforcer,
        {
          ...(options.limits?.runBudgetUsd !== undefined && {
            defaultBudgetUsd: options.limits.runBudgetUsd,
          }),
        },
      );
      return runService;
    },
    /** Opens a run without sending anything, so tests can drive the Hub by hand. */
    async openRun(
      graph: GraphDefinition = buildTestGraph(),
      graphVersionId?: string,
      budgetUsd?: number,
    ): Promise<string> {
      const versionId =
        graphVersionId ?? (await persistence.versions.appendNext(graph.id, graph)).id;
      const { record } = await persistence.runs.createRunning(
        versionId,
        () => [],
        budgetUsd === undefined ? {} : { budgetUsd },
      );
      registry.register(record.id, graph, budgetUsd);
      return record.id;
    },
  };
}

/** The wiring with scriptable fake runtimes, for tests. */
export function createHubHarness(persistence: HubPersistence, options: HubHarnessOptions = {}) {
  const runtimes = new FakeAgentRuntimeFactory(options.scripts, options.runtimeOptions);
  const wiring = createHubWiring(persistence, runtimes, options);
  // Not a spread: `runService` is a getter that must stay lazy.
  return Object.defineProperty(wiring, "runtimes", {
    value: runtimes,
    enumerable: true,
  }) as typeof wiring & {
    runtimes: FakeAgentRuntimeFactory;
  };
}
