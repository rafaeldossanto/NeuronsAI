import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoPublishedVersionError } from "./triggers.errors.js";
import {
  SCHEDULE_TRIGGER,
  WEBHOOK_TRIGGER,
  createTriggerRig,
  graphWithExternalTriggers,
} from "./testing/trigger-rig.js";
import { webhookSecretName } from "./triggers.service.js";
import { computeSignature } from "./webhook-signature.js";
import type { WebhookRequest } from "./webhook.service.js";

type Rig = Awaited<ReturnType<typeof createTriggerRig>>;

const NOW = new Date("2026-11-04T15:00:00.000Z");
const body = Buffer.from('{"cliente":"Ana","mensagem":"quero comprar"}');

describe("WebhookService", () => {
  let rig: Rig;
  let secret: string;
  let hookId: string;

  /** A correctly signed request, `skewSec` away from the (fake) current time. */
  const request = (overrides: Partial<WebhookRequest> = {}, skewSec = 0): WebhookRequest => {
    const timestamp = String(NOW.getTime() / 1000 + skewSec);
    return {
      hookId,
      timestampHeader: timestamp,
      signatureHeader: `sha256=${computeSignature(secret, timestamp, overrides.body ?? body)}`,
      body,
      ...overrides,
    };
  };

  const setUp = async (options: { ratePerMinute?: number } = {}) => {
    vi.useFakeTimers({ now: NOW });
    rig = await createTriggerRig(options);
    await rig.publish();
    const created = await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);
    secret = created.secret;
    hookId = created.view.hookId!;
    await rig.triggers.setEnabled(rig.graph.id, WEBHOOK_TRIGGER, true);
  };

  beforeEach(() => setUp());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts a run of the latest published version with the body as the first message", async () => {
    const first = await rig.publish();
    const second = await rig.publish(graphWithExternalTriggers({ cron: "0 9 * * 1" }));

    const result = await rig.webhook.handle(request());

    expect(result.kind).toBe("accepted");
    expect(rig.runService.starts).toEqual([
      { versionId: second.id, input: body.toString("utf8"), triggerId: WEBHOOK_TRIGGER },
    ]);
    expect(rig.runService.starts[0]?.versionId).not.toBe(first.id);
  });

  it("records the last run on the trigger", async () => {
    const result = await rig.webhook.handle(request());
    if (result.kind !== "accepted") throw new Error("not accepted");

    expect(await rig.triggers.get(rig.graph.id, WEBHOOK_TRIGGER)).toMatchObject({
      lastOutcome: "started",
      lastRunId: result.runId,
      lastFiredAt: NOW,
    });
  });

  it("sends a note instead of nothing when the body is empty", async () => {
    const empty = Buffer.alloc(0);
    await rig.webhook.handle(request({ body: empty }));
    expect(rig.runService.starts[0]?.input).toBe("(requisição sem corpo)");
  });

  describe("refuses with the same answer, and starts nothing", () => {
    const expectRefused = async (req: WebhookRequest) => {
      expect(await rig.webhook.handle(req)).toEqual({ kind: "unauthorized" });
      expect(rig.runService.starts).toHaveLength(0);
    };

    it("a wrong signature", async () => {
      const other = request();
      await expectRefused({ ...other, signatureHeader: `sha256=${"0".repeat(64)}` });
    });

    it("a body altered after signing", async () => {
      await expectRefused({ ...request(), body: Buffer.from('{"cliente":"Beto"}') });
    });

    it("an expired signature (older than 5 minutes)", async () => {
      await expectRefused(request({}, -301));
    });

    it("a timestamp too far in the future", async () => {
      await expectRefused(request({}, 301));
    });

    it("missing or malformed headers", async () => {
      await expectRefused({ ...request(), timestampHeader: undefined });
      await expectRefused({ ...request(), signatureHeader: undefined });
      await expectRefused({ ...request(), signatureHeader: "sha256=abc" });
    });

    it("an unknown hook id", async () => {
      await expectRefused({ ...request(), hookId: "nao-existe" });
    });

    it("a trigger that is turned off", async () => {
      await rig.triggers.setEnabled(rig.graph.id, WEBHOOK_TRIGGER, false);
      await expectRefused(request());
    });

    it("a signature made with the old secret after the secret changed", async () => {
      const oldRequest = request();
      await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);
      await expectRefused(oldRequest);
    });

    it("a secret that can no longer be read", async () => {
      rig.secretRepository.stored.delete(webhookSecretName(hookId));
      await expectRefused(request());
    });
  });

  describe("replay", () => {
    it("accepts a request once and refuses the identical one again", async () => {
      const req = request();
      expect((await rig.webhook.handle(req)).kind).toBe("accepted");
      expect(await rig.webhook.handle(req)).toEqual({ kind: "unauthorized" });
      expect(rig.runService.starts).toHaveLength(1);
    });

    it("refuses a copy sent at the same time as the original", async () => {
      const req = request();
      const results = await Promise.all([rig.webhook.handle(req), rig.webhook.handle(req)]);
      expect(results.map((result) => result.kind).sort()).toEqual(["accepted", "unauthorized"]);
      expect(rig.runService.starts).toHaveLength(1);
    });

    it("accepts a new request with the same body, because the timestamp is signed too", async () => {
      expect((await rig.webhook.handle(request())).kind).toBe("accepted");
      expect((await rig.webhook.handle(request({}, 1))).kind).toBe("accepted");
      expect(rig.runService.starts).toHaveLength(2);
    });

    it("still refuses the replay of a request stamped in the future, until its window ends", async () => {
      const req = request({}, 300);
      expect((await rig.webhook.handle(req)).kind).toBe("accepted");
      // 9 minutes later the request is still within its own window (stamped 5 min ahead): remembered.
      vi.setSystemTime(new Date(NOW.getTime() + 9 * 60_000));
      await rig.webhook.handle(request({}, 9 * 60)); // an accepted call purges what is old enough
      expect(await rig.webhook.handle(req)).toEqual({ kind: "unauthorized" });
    });

    it("forgets signatures once they can no longer pass the window", async () => {
      const req = request();
      await rig.webhook.handle(req);
      vi.setSystemTime(new Date(NOW.getTime() + 20 * 60_000));
      // A later accepted call purges what is old enough (in the background).
      await rig.webhook.handle(request({}, 20 * 60));
      await vi.advanceTimersByTimeAsync(0);

      const original = req.signatureHeader!.slice("sha256=".length);
      expect(await rig.states.recordDelivery(hookId, original, new Date())).toBe(true);
      // Forgotten, yet still refused: the window itself no longer lets it through.
      expect(await rig.webhook.handle(req)).toEqual({ kind: "unauthorized" });
    });
  });

  describe("rate limit per trigger", () => {
    beforeEach(() => setUp({ ratePerMinute: 3 }));

    it("answers rate_limited after the burst, even for wrong signatures", async () => {
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await rig.webhook.handle(request({}, i)));
      expect(results.map((result) => result.kind)).toEqual([
        "accepted",
        "accepted",
        "accepted",
        "rate_limited",
        "rate_limited",
      ]);
      expect(rig.runService.starts).toHaveLength(3);
    });

    it("throttles guessing at unknown ids as a whole", async () => {
      const kinds = [];
      for (let i = 0; i < 5; i++) {
        kinds.push((await rig.webhook.handle({ ...request(), hookId: `chute-${i}` })).kind);
      }
      expect(kinds).toEqual([
        "unauthorized",
        "unauthorized",
        "unauthorized",
        "rate_limited",
        "rate_limited",
      ]);
    });

    it("does not let one trigger's traffic use up another's allowance", async () => {
      for (let i = 0; i < 5; i++) await rig.webhook.handle({ ...request(), hookId: `chute-${i}` });
      expect((await rig.webhook.handle(request())).kind).toBe("accepted");
    });

    it("recovers as time passes", async () => {
      for (let i = 0; i < 4; i++) await rig.webhook.handle(request({}, i));
      vi.advanceTimersByTime(20_000);
      expect((await rig.webhook.handle(request({}, 20))).kind).toBe("accepted");
    });
  });

  describe("after the signature is right", () => {
    it("tells the caller clearly when the graph has no published version", async () => {
      // Possible only for a trigger prepared before its versions went away; build that state by hand.
      const bare = await createTriggerRig();
      const bareSecret = randomBytes(32).toString("base64url");
      await bare.states.ensure(bare.graph.id, WEBHOOK_TRIGGER, "bare-hook");
      await bare.states.update(bare.graph.id, WEBHOOK_TRIGGER, {
        enabled: true,
        secretSetAt: new Date(),
      });
      await bare.secrets.set(webhookSecretName("bare-hook"), bareSecret);

      const timestamp = String(NOW.getTime() / 1000);
      const call = bare.webhook.handle({
        hookId: "bare-hook",
        timestampHeader: timestamp,
        signatureHeader: `sha256=${computeSignature(bareSecret, timestamp, body)}`,
        body,
      });

      await expect(call).rejects.toBeInstanceOf(NoPublishedVersionError);
      expect(bare.runService.starts).toHaveLength(0);
      expect(await bare.triggers.get(bare.graph.id, WEBHOOK_TRIGGER)).toMatchObject({
        lastOutcome: "failed",
        lastNote: expect.stringContaining("versão publicada") as string,
      });
    });

    it("refuses when the latest version no longer has the trigger as a webhook", async () => {
      await rig.publish(graphWithExternalTriggers({ id: "outro-id" }));
      const noWebhook = graphWithExternalTriggers();
      await rig.publish({
        ...noWebhook,
        nodes: noWebhook.nodes.filter((node) => node.id !== WEBHOOK_TRIGGER),
      });

      await expect(rig.webhook.handle(request())).rejects.toMatchObject({
        code: "trigger_not_in_version",
      });
      expect(rig.runService.starts).toHaveLength(0);
    });

    it("passes on the failure of the run itself and records it", async () => {
      rig.runService.failWith = new Error("falhou por dentro");
      await expect(rig.webhook.handle(request())).rejects.toThrow("falhou por dentro");
      expect(await rig.triggers.get(rig.graph.id, WEBHOOK_TRIGGER)).toMatchObject({
        lastOutcome: "failed",
        lastNote: "Erro inesperado ao iniciar a execução.",
      });
    });
  });

  describe("logs", () => {
    it("never write the secret, the signature or the body", async () => {
      const lines: string[] = [];
      for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
          lines.push(String(message));
        });
      }
      const accepted = request();
      await rig.webhook.handle(accepted);
      await rig.webhook.handle(accepted); // replay
      await rig.webhook.handle({ ...request(), signatureHeader: `sha256=${"a".repeat(64)}` });

      const text = lines.join("\n");
      expect(text).toContain("aceito");
      expect(text).toContain("recusado");
      expect(text).not.toContain(secret);
      expect(text).not.toContain(accepted.signatureHeader!.slice(7));
      expect(text).not.toContain("a".repeat(64));
      expect(text).not.toContain("quero comprar");
      expect(text).not.toContain(hookId);
    });
  });

  it("only serves webhook triggers: a schedule trigger has no route", async () => {
    // The trigger id of a schedule never gets a secret through the webhook route.
    const view = await rig.triggers.get(rig.graph.id, SCHEDULE_TRIGGER);
    expect(view.hookId).toBeNull();
  });
});
