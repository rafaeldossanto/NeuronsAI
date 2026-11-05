import { Logger } from "@nestjs/common";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MISSED_TOLERANCE_MS, type TriggerScheduler } from "./trigger-scheduler.js";
import {
  SCHEDULE_TRIGGER,
  createTriggerRig,
  graphWithExternalTriggers,
} from "./testing/trigger-rig.js";

type Rig = Awaited<ReturnType<typeof createTriggerRig>>;

// A Wednesday, 12:00:30 UTC: the next full minute is 12:01.
const START = new Date("2026-11-04T12:00:30.000Z");
const MINUTE = 60_000;

describe("TriggerScheduler", () => {
  let rig: Rig;
  let scheduler: TriggerScheduler;

  beforeAll(() => Logger.overrideLogger(false));

  const startScheduler = async (clock?: () => number) => {
    scheduler = rig.scheduler(clock);
    await scheduler.onApplicationBootstrap();
  };

  const state = () => rig.states.find(rig.graph.id, SCHEDULE_TRIGGER);
  const turnOn = () => rig.triggers.setEnabled(rig.graph.id, SCHEDULE_TRIGGER, true);
  /** Lets the timers and the promises they start settle. */
  const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(async () => {
    vi.useFakeTimers({ now: START });
    rig = await createTriggerRig();
    await rig.publish(graphWithExternalTriggers({ cron: "* * * * *", timezone: "UTC" }));
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    vi.useRealTimers();
  });

  it("fires at the scheduled moment with the cron's own message, and not before", async () => {
    await startScheduler();
    await turnOn();

    await elapse(29_999);
    expect(rig.runService.starts).toHaveLength(0);
    await elapse(1);

    expect(rig.runService.starts).toHaveLength(1);
    expect(rig.runService.starts[0]).toMatchObject({
      triggerId: SCHEDULE_TRIGGER,
      input: 'Execução agendada (cron "* * * * *"), disparada em 2026-11-04T12:01:00.000Z.',
    });
  });

  it("runs the latest published version, read when it fires", async () => {
    await startScheduler();
    await turnOn();
    const newer = await rig.publish(graphWithExternalTriggers({ cron: "* * * * *" }));

    await elapse(30_000);

    expect(rig.runService.starts[0]?.versionId).toBe(newer.id);
  });

  it("stores the last and the next run", async () => {
    await startScheduler();
    await turnOn();
    expect((await state())?.nextRunAt).toEqual(new Date("2026-11-04T12:01:00.000Z"));

    await elapse(30_000);

    expect(await state()).toMatchObject({
      lastOutcome: "started",
      lastFiredAt: new Date("2026-11-04T12:01:00.000Z"),
      lastRunId: expect.any(String) as string,
      nextRunAt: new Date("2026-11-04T12:02:00.000Z"),
    });
  });

  it("keeps firing minute after minute", async () => {
    await startScheduler();
    await turnOn();
    await elapse(30_000);
    // Each run ends before the next moment: nothing overlaps.
    for (const id of rig.runService.records.keys()) rig.runService.finish(id);
    await elapse(MINUTE);
    for (const id of rig.runService.records.keys()) rig.runService.finish(id);
    await elapse(MINUTE);

    expect(rig.runService.starts).toHaveLength(3);
  });

  describe("no overlap", () => {
    it("skips the moment while the previous run is still going, and says why", async () => {
      await startScheduler();
      await turnOn();
      await elapse(30_000);
      const first = (await state())!.lastRunId!;

      await elapse(MINUTE); // the first run has not finished

      expect(rig.runService.starts).toHaveLength(1);
      expect(await state()).toMatchObject({
        lastOutcome: "skipped_overlap",
        lastNote: expect.stringContaining(first) as string,
        lastRunId: first,
        nextRunAt: new Date("2026-11-04T12:03:00.000Z"),
      });
    });

    it("fires again once the previous run has finished", async () => {
      await startScheduler();
      await turnOn();
      await elapse(30_000);
      await elapse(MINUTE); // skipped
      for (const id of rig.runService.records.keys()) rig.runService.finish(id);

      await elapse(MINUTE);

      expect(rig.runService.starts).toHaveLength(2);
      expect((await state())?.lastOutcome).toBe("started");
    });

    it("logs the reason of the skip", async () => {
      const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      await startScheduler();
      await turnOn();
      await elapse(30_000);
      await elapse(MINUTE);

      expect(log).toHaveBeenCalledWith(expect.stringContaining("ainda está em andamento"));
    });
  });

  describe("moments missed while the app was not running", () => {
    it("does not make them up when the app starts: it follows from now", async () => {
      // The trigger was on, and the app was closed for two days.
      await rig.triggers.setEnabled(rig.graph.id, SCHEDULE_TRIGGER, true);
      vi.setSystemTime(new Date(START.getTime() + 48 * 60 * MINUTE));

      await startScheduler();
      expect(rig.runService.starts).toHaveLength(0);

      const resumed = Date.now();
      expect((await state())?.nextRunAt?.getTime()).toBeGreaterThan(resumed);
      await elapse(MINUTE);
      expect(rig.runService.starts).toHaveLength(1);
    });

    it("skips a moment the process slept through instead of firing it late", async () => {
      let skew = 0;
      await startScheduler(() => Date.now() + skew);
      await turnOn();

      // The computer slept: the timer wakes up two hours after the moment it was set for.
      skew = 2 * 60 * MINUTE;
      await elapse(30_000);

      expect(rig.runService.starts).toHaveLength(0);
      expect(await state()).toMatchObject({
        lastOutcome: "skipped_missed",
        lastNote: expect.stringContaining("perdido") as string,
      });
      // ...and the schedule goes on from the moment it woke up.
      expect((await state())?.nextRunAt?.getTime()).toBeGreaterThan(Date.now() + skew);
    });

    it("still fires a moment that is only a little late", async () => {
      let skew = 0;
      await startScheduler(() => Date.now() + skew);
      await turnOn();
      skew = MISSED_TOLERANCE_MS - 1;

      await elapse(30_000);

      expect(rig.runService.starts).toHaveLength(1);
    });
  });

  describe("time zone", () => {
    it("reads the cron in the trigger's zone", async () => {
      // 09:00 in São Paulo (UTC-3) is 12:00 UTC: the next one is tomorrow's, 24 h - 30 s away.
      await rig.publish(
        graphWithExternalTriggers({ cron: "0 9 * * *", timezone: "America/Sao_Paulo" }),
      );
      await startScheduler();
      await turnOn();

      expect((await state())?.nextRunAt).toEqual(new Date("2026-11-05T12:00:00.000Z"));
      await elapse(24 * 60 * MINUTE - 31_000);
      expect(rig.runService.starts).toHaveLength(0);
      await elapse(1_000);
      expect(rig.runService.starts).toHaveLength(1);
    });

    it("waits through delays longer than a timer can hold", async () => {
      await rig.publish(graphWithExternalTriggers({ cron: "0 0 1 1 *", timezone: "UTC" }));
      await startScheduler();
      await turnOn();

      expect((await state())?.nextRunAt).toEqual(new Date("2027-01-01T00:00:00.000Z"));
      // 57.5 days away: more than the 2^31 ms (about 24.8 days) a single timer can hold.
      await elapse(57 * 24 * 60 * MINUTE);
      expect(rig.runService.starts).toHaveLength(0);
      await elapse(12 * 60 * MINUTE);
      expect(rig.runService.starts).toHaveLength(1);
    });
  });

  describe("turning on and off", () => {
    it("does nothing while the trigger is off, whatever the cron says", async () => {
      await startScheduler();
      await elapse(10 * MINUTE);
      expect(rig.runService.starts).toHaveLength(0);
      expect(scheduler.armedCount).toBe(0);
    });

    it("stops firing and clears the next moment when turned off", async () => {
      await startScheduler();
      await turnOn();
      await rig.triggers.setEnabled(rig.graph.id, SCHEDULE_TRIGGER, false);

      await elapse(5 * MINUTE);

      expect(rig.runService.starts).toHaveLength(0);
      expect(scheduler.armedCount).toBe(0);
      expect((await state())?.nextRunAt).toBeNull();
    });

    it("loads the triggers that were on when the app starts", async () => {
      await rig.triggers.setEnabled(rig.graph.id, SCHEDULE_TRIGGER, true);
      await startScheduler();
      expect(scheduler.armedCount).toBe(1);
      await elapse(30_000);
      expect(rig.runService.starts).toHaveLength(1);
    });

    it("follows a new version: the cron it publishes replaces the old one", async () => {
      await startScheduler();
      await turnOn();
      expect((await state())?.nextRunAt).toEqual(new Date("2026-11-04T12:01:00.000Z"));

      await rig.publish(graphWithExternalTriggers({ cron: "0 18 * * *", timezone: "UTC" }));
      await elapse(0);

      expect((await state())?.nextRunAt).toEqual(new Date("2026-11-04T18:00:00.000Z"));
      await elapse(10 * MINUTE);
      expect(rig.runService.starts).toHaveLength(0);
    });
  });

  it("records a failure to start the run and keeps going", async () => {
    await startScheduler();
    await turnOn();
    rig.runService.failWith = new Error("sem runner");

    await elapse(30_000);

    expect(await state()).toMatchObject({
      lastOutcome: "failed",
      lastNote: "Erro inesperado ao iniciar a execução.",
      nextRunAt: new Date("2026-11-04T12:02:00.000Z"),
    });
    await elapse(MINUTE);
    expect(rig.runService.starts).toHaveLength(1);
  });
});
