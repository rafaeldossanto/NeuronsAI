import { describe, expect, it } from "vitest";
import { curlExample, describeCron, formatMoment, upcomingRuns } from "./trigger-helpers";

describe("describeCron", () => {
  it.each([
    ["0 9 * * 1", "Às 09:00, somente de segunda-feira"],
    ["0 9 * * 1-5", "Às 09:00, de segunda-feira a sexta-feira"],
    ["* * * * *", "A cada minuto"],
    ["30 2 1 * *", "Às 02:30, no dia 1 do mês"],
  ])("explains %s in Portuguese", (expression, text) => {
    expect(describeCron(expression)).toBe(text);
  });

  it("is null for what is not a valid cron", () => {
    expect(describeCron("toda segunda")).toBeNull();
    expect(describeCron("")).toBeNull();
    expect(describeCron("0 0 31 2 *")).toBeNull();
  });
});

describe("upcomingRuns", () => {
  const from = new Date("2026-11-04T12:00:00.000Z");

  it("lists the next three moments in the zone", () => {
    const runs = upcomingRuns("0 9 * * 1", "America/Sao_Paulo", 3, from);
    expect(runs.map((run) => run.toISOString())).toEqual([
      "2026-11-09T12:00:00.000Z",
      "2026-11-16T12:00:00.000Z",
      "2026-11-23T12:00:00.000Z",
    ]);
  });

  it("is empty for an invalid cron or zone", () => {
    expect(upcomingRuns("nada", undefined, 3, from)).toEqual([]);
    expect(upcomingRuns("* * * * *", "Marte/Olympus", 3, from)).toEqual([]);
  });
});

describe("formatMoment", () => {
  it("writes the moment as read in the zone", () => {
    const moment = new Date("2026-11-09T12:00:00.000Z");
    expect(formatMoment(moment, "America/Sao_Paulo")).toContain("09:00");
    expect(formatMoment(moment, "UTC")).toContain("12:00");
  });
});

describe("curlExample", () => {
  const url = "http://127.0.0.1:3101/hooks/abc";
  const example = curlExample(url);

  it("posts to the URL with the timestamp and the signature headers", () => {
    expect(example).toContain(`curl -X POST '${url}'`);
    expect(example).toContain('-H "X-Neurons-Timestamp: $TS"');
    expect(example).toContain('-H "X-Neurons-Signature: sha256=$SIG"');
    expect(example).toContain("--data-binary");
  });

  it("signs timestamp.body and reads the secret from the environment, never holding it", () => {
    expect(example).toContain(`printf '%s.%s' "$TS" "$BODY"`);
    expect(example).toContain('-hmac "$NEURONS_WEBHOOK_SECRET"');
    expect(example).not.toMatch(/whsec_/);
  });
});
