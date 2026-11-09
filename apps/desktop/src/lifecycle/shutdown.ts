/** A step slower than this is said in the log, so a slow quit shows who was slow. */
const SLOW_STEP_MS = 1_000;

/** One thing that must be closed before the process leaves. */
export interface ShutdownStep {
  /** Said in the log when the step fails or runs out of time (never the error's own details). */
  name: string;
  run: () => unknown;
  /** How long the step may take. A step that does not finish in time is left behind. */
  timeoutMs: number;
}

export interface ShutdownOptions {
  /** In order: each one starts when the one before ended, or ran out of time. */
  steps: readonly ShutdownStep[];
  /** Leaves the process for good (`app.exit`). Always called, once, after the last step. */
  exit: () => void;
  log: (line: string) => void;
  /** What to add to the log when a step runs out of time: what is still holding the process. */
  diagnose?: () => string;
}

/**
 * The orderly end of the app: closes the pieces one after the other (accounts, then the embedded
 * server with its agents, terminals and database) and then leaves, **whatever happened**. A step
 * that throws or never answers is logged and left behind, so a hung close can never keep the
 * process alive: the person asked to quit, and the packaged app has to go away on its own.
 *
 * Calling `run` again returns the shutdown already under way (quitting twice is harmless).
 */
export function createShutdown(options: ShutdownOptions): { run(): Promise<void> } {
  let underWay: Promise<void> | undefined;

  const runStep = async (step: ShutdownStep): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), step.timeoutMs);
    });
    try {
      const outcome = await Promise.race([
        Promise.resolve()
          .then(step.run)
          .then(() => "done" as const),
        timedOut,
      ]);
      const tookMs = Date.now() - startedAt;
      if (outcome === "done" && tookMs >= SLOW_STEP_MS) {
        options.log(`Encerramento: "${step.name}" levou ${String(tookMs)} ms.`);
      }
      if (outcome === "timeout") {
        const holding = options.diagnose?.();
        options.log(
          `Encerramento: "${step.name}" passou de ${String(step.timeoutMs)} ms; seguindo sem esperar.${holding ? ` Ainda aberto: ${holding}.` : ""}`,
        );
      }
    } catch (error) {
      options.log(
        `Encerramento: "${step.name}" falhou (${error instanceof Error ? error.name : "erro"}).`,
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    run() {
      underWay ??= (async () => {
        try {
          for (const step of options.steps) await runStep(step);
        } finally {
          options.exit();
        }
      })();
      return underWay;
    },
  };
}
