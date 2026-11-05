import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { nextCronRun } from "@neurons/graph-schema";
import type { Subscription } from "rxjs";
import { GraphVersionService } from "../graphs/graph-version.service.js";
import { RUN_REPOSITORY, type RunRepository } from "../run-log/run-repository.js";
import { DomainError } from "../shared/errors/domain-error.js";
import { TriggerLauncher } from "./trigger-launcher.js";
import {
  TRIGGER_STATE_REPOSITORY,
  type TriggerStatePatch,
  type TriggerStateRepository,
} from "./trigger-state.js";
import { TriggersService } from "./triggers.service.js";
import { resourceScope } from "../accounts/resource-scope.js";

/** `setTimeout` cannot wait longer than this; a longer wait is made in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * How late a schedule may fire and still count as on time. The timer is late when the computer
 * slept through the moment (or the process was frozen): then the moment is skipped, not made up.
 */
export const MISSED_TOLERANCE_MS = 60_000;

interface Armed {
  graphId: string;
  triggerId: string;
  cron: string;
  timezone: string | undefined;
  dueAt: Date;
  timer: NodeJS.Timeout;
}

/** Where "now" comes from; tests replace it to make the process sleep through a moment. */
export const SCHEDULER_CLOCK = Symbol("SCHEDULER_CLOCK");

const keyOf = (graphId: string, triggerId: string) => `${graphId}/${triggerId}`;

/**
 * Fires the `schedule` triggers that are turned on, inside this process (one server per data
 * folder, so a schedule never fires twice).
 *
 * - The cron runs in the trigger's time zone, or in the system's when it names none.
 * - **No overlap:** if the run this trigger started last is still going, the moment is skipped and
 *   the reason is recorded (and logged).
 * - **Nothing is made up:** while the app is closed nothing fires, and on the next start the
 *   schedule simply follows from now. A moment the process slept through is skipped too.
 * - It runs the latest published version, read when it fires; publishing a new version re-reads
 *   the cron and the time zone at once.
 */
@Injectable()
export class TriggerScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TriggerScheduler.name);
  private readonly armed = new Map<string, Armed>();
  private readonly subscriptions: Subscription[] = [];
  /** Syncs one after the other, so two quick changes to a trigger cannot race. */
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    @Inject(TRIGGER_STATE_REPOSITORY) private readonly states: TriggerStateRepository,
    @Inject(RUN_REPOSITORY) private readonly runs: RunRepository,
    @Inject(TriggerLauncher) private readonly launcher: TriggerLauncher,
    @Inject(TriggersService) private readonly triggers: TriggersService,
    @Inject(GraphVersionService) private readonly versions: GraphVersionService,
    @Optional() @Inject(SCHEDULER_CLOCK) private readonly clock: () => number = () => Date.now(),
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.triggers.onChange(({ graphId, triggerId }) =>
      this.enqueue(() => this.sync(graphId, triggerId)),
    );
    this.subscriptions.push(
      this.versions.published.subscribe(({ graphId }) => {
        void this.enqueue(() => this.syncGraph(graphId));
      }),
    );
    try {
      await this.enqueue(() => this.syncAll());
    } catch (error) {
      // No database (Postgres not configured): there is nothing to schedule, and /health says why.
      this.logger.warn(
        `Agendamentos não carregados: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    for (const entry of this.armed.values()) clearTimeout(entry.timer);
    this.armed.clear();
  }

  /** Triggers the scheduler is waiting on right now (for tests and diagnostics). */
  get armedCount(): number {
    return this.armed.size;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const bound = resourceScope.bind(task);
    const next = this.queue.then(bound, bound).catch((error: unknown) => {
      this.logger.error(
        `Falha ao atualizar um agendamento: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    this.queue = next;
    return next;
  }

  private async syncAll(): Promise<void> {
    for (const state of await this.states.listEnabled()) {
      await resourceScope.run({ organizationId: state.organizationId ?? null }, () =>
        this.sync(state.graphId, state.triggerId),
      );
    }
  }

  private async syncGraph(graphId: string): Promise<void> {
    for (const state of await this.states.listEnabled()) {
      if (state.graphId === graphId) await this.sync(graphId, state.triggerId);
    }
  }

  /** Brings the timer of one trigger in line with its state and with the latest published version. */
  private async sync(graphId: string, triggerId: string): Promise<void> {
    this.disarm(graphId, triggerId);
    const state = await this.states.find(graphId, triggerId);
    if (!state?.enabled) {
      if (state?.nextRunAt) await this.record(graphId, triggerId, { nextRunAt: null });
      return;
    }
    let cron: string | undefined;
    let timezone: string | undefined;
    try {
      const { trigger } = await this.launcher.resolve(graphId, triggerId, "schedule");
      cron = trigger.cron;
      timezone = trigger.timezone;
    } catch (error) {
      // Nothing to run (no version, or the trigger is gone or is not a schedule any more).
      this.logger.warn(
        `Agenda ${graphId}/${triggerId} sem o que rodar: ${error instanceof DomainError ? error.message : "erro inesperado"}`,
      );
      await this.record(graphId, triggerId, { nextRunAt: null });
      return;
    }
    if (cron === undefined) return;
    await this.arm({ graphId, triggerId, cron, timezone });
  }

  private async arm(spec: Omit<Armed, "dueAt" | "timer">): Promise<void> {
    if (this.stopped) return;
    const dueAt = nextCronRun(spec.cron, {
      ...(spec.timezone !== undefined && { timezone: spec.timezone }),
      from: new Date(this.clock()),
    });
    if (!dueAt) {
      await this.record(spec.graphId, spec.triggerId, { nextRunAt: null });
      return;
    }
    this.wait({ ...spec, dueAt });
    await this.record(spec.graphId, spec.triggerId, { nextRunAt: dueAt });
  }

  private wait(spec: Omit<Armed, "timer">): void {
    const delay = Math.min(Math.max(spec.dueAt.getTime() - this.clock(), 0), MAX_TIMER_MS);
    const timer = setTimeout(
      resourceScope.bind(() => void this.onTimer(spec.graphId, spec.triggerId)),
      delay,
    );
    timer.unref();
    this.armed.set(keyOf(spec.graphId, spec.triggerId), { ...spec, timer });
  }

  private disarm(graphId: string, triggerId: string): void {
    const key = keyOf(graphId, triggerId);
    const entry = this.armed.get(key);
    if (entry) clearTimeout(entry.timer);
    this.armed.delete(key);
  }

  private async onTimer(graphId: string, triggerId: string): Promise<void> {
    const entry = this.armed.get(keyOf(graphId, triggerId));
    if (!entry) return;
    const lateMs = this.clock() - entry.dueAt.getTime();
    if (lateMs < 0) {
      // A long wait made in steps, or a timer that woke a little early: keep waiting.
      this.wait(entry);
      return;
    }
    // Next moment first, counted from now: whatever happens below, the schedule goes on.
    this.disarm(graphId, triggerId);
    await this.arm(entry);
    if (lateMs > MISSED_TOLERANCE_MS) {
      const note = `Horário das ${entry.dueAt.toISOString()} perdido (o computador estava suspenso ou o app parado); não foi recuperado.`;
      this.logger.warn(`Agenda ${graphId}/${triggerId}: ${note}`);
      await this.record(graphId, triggerId, {
        lastFiredAt: new Date(this.clock()),
        lastOutcome: "skipped_missed",
        lastNote: note,
      });
      return;
    }
    await this.fire(entry);
  }

  private async fire(entry: Armed): Promise<void> {
    const { graphId, triggerId } = entry;
    const state = await this.states.find(graphId, triggerId);
    if (!state?.enabled) return;
    const now = new Date(this.clock());

    if (state.lastRunId) {
      const previous = await this.runs.findById(state.lastRunId);
      if (previous?.status === "running" || previous?.status === "pending") {
        const note = `A execução anterior (${previous.id}) ainda está em andamento; este horário foi pulado.`;
        this.logger.log(`Agenda ${graphId}/${triggerId}: ${note}`);
        await this.record(graphId, triggerId, {
          lastFiredAt: now,
          lastOutcome: "skipped_overlap",
          lastNote: note,
        });
        return;
      }
    }

    const input = `Execução agendada (cron "${entry.cron}"), disparada em ${now.toISOString()}.`;
    try {
      const run = await this.launcher.launch(graphId, triggerId, "schedule", input);
      this.logger.log(`Agenda ${graphId}/${triggerId}: execução ${run.id} iniciada.`);
      await this.record(graphId, triggerId, {
        lastFiredAt: now,
        lastOutcome: "started",
        lastNote: null,
        lastRunId: run.id,
      });
    } catch (error) {
      const note =
        error instanceof DomainError ? error.message : "Erro inesperado ao iniciar a execução.";
      this.logger.warn(`Agenda ${graphId}/${triggerId}: não iniciou (${note})`);
      await this.record(graphId, triggerId, {
        lastFiredAt: now,
        lastOutcome: "failed",
        lastNote: note,
      });
    }
  }

  private async record(
    graphId: string,
    triggerId: string,
    patch: TriggerStatePatch,
  ): Promise<void> {
    try {
      await this.states.update(graphId, triggerId, patch);
    } catch (error) {
      this.logger.warn(
        `Não foi possível gravar o estado do agendamento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
