import { describe, expect, it } from "vitest";
import { checkCron, isValidTimezone, nextCronRun, nextCronRuns } from "./cron.js";

describe("checkCron", () => {
  it.each(["* * * * *", "0 9 * * 1-5", "*/15 8-18 * * *", "30 2 1 * *", "0 0 29 2 *"])(
    "accepts %s",
    (expression) => {
      expect(checkCron(expression)).toEqual({ ok: true });
    },
  );

  it.each([
    "",
    "   ",
    "0 9 * *",
    "0 0 9 * * *",
    "@daily",
    "61 * * * *",
    "* 25 * * *",
    "a b c d e",
    "0 9 * * 9",
  ])("rejects %j with the format hint", (expression) => {
    const result = checkCron(expression);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Expressão cron inválida");
  });

  it("rejects an expression that never fires", () => {
    const result = checkCron("0 0 31 2 *");
    expect(result).toEqual({
      ok: false,
      message: "Essa expressão cron nunca dispara: confira o dia e o mês.",
    });
  });
});

describe("isValidTimezone", () => {
  it.each(["America/Sao_Paulo", "UTC", "Europe/Lisbon"])("accepts %s", (zone) => {
    expect(isValidTimezone(zone)).toBe(true);
  });

  it.each(["", " ", "Marte/Olympus", "GMT+99"])("rejects %j", (zone) => {
    expect(isValidTimezone(zone)).toBe(false);
  });
});

describe("nextCronRuns", () => {
  const from = new Date("2026-11-04T12:00:00.000Z"); // quarta-feira

  it("lists the next moments in order", () => {
    const runs = nextCronRuns("0 9 * * 1", { timezone: "UTC", from, count: 3 });
    expect(runs.map((run) => run.toISOString())).toEqual([
      "2026-11-09T09:00:00.000Z",
      "2026-11-16T09:00:00.000Z",
      "2026-11-23T09:00:00.000Z",
    ]);
  });

  it("reads the expression in the given time zone", () => {
    // São Paulo está em UTC-3 (sem horário de verão desde 2019): 9h lá são 12h UTC.
    const next = nextCronRun("0 9 * * *", { timezone: "America/Sao_Paulo", from });
    expect(next?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    const utc = nextCronRun("0 9 * * *", { timezone: "UTC", from });
    expect(utc?.toISOString()).toBe("2026-11-05T09:00:00.000Z");
  });

  it("follows daylight saving time of the zone", () => {
    // Lisboa: UTC+0 no inverno e UTC+1 no verão.
    const winter = nextCronRun("0 9 * * *", {
      timezone: "Europe/Lisbon",
      from: new Date("2026-01-10T00:00:00Z"),
    });
    const summer = nextCronRun("0 9 * * *", {
      timezone: "Europe/Lisbon",
      from: new Date("2026-07-10T00:00:00Z"),
    });
    expect(winter?.toISOString()).toBe("2026-01-10T09:00:00.000Z");
    expect(summer?.toISOString()).toBe("2026-07-10T08:00:00.000Z");
  });

  it("is empty for an invalid expression or zone", () => {
    expect(nextCronRuns("não é cron", { from })).toEqual([]);
    expect(nextCronRuns("* * * * *", { timezone: "Marte/Olympus", from })).toEqual([]);
    expect(nextCronRun("0 0 31 2 *", { from })).toBeUndefined();
  });

  it("never returns the moment `from` itself", () => {
    const exact = new Date("2026-11-04T12:00:00.000Z");
    expect(nextCronRun("0 12 * * *", { timezone: "UTC", from: exact })?.toISOString()).toBe(
      "2026-11-05T12:00:00.000Z",
    );
  });
});
