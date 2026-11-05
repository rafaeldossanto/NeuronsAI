import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import { SecretsService } from "../secrets/secrets.service.js";
import { UnavailableSecretCipher } from "../secrets/secret-cipher.js";
import { InMemorySecretRepository } from "../secrets/testing/in-memory-secret-repository.js";
import { TriggersService, webhookSecretName } from "./triggers.service.js";
import { SCHEDULE_TRIGGER, WEBHOOK_TRIGGER, createTriggerRig } from "./testing/trigger-rig.js";

describe("TriggersService", () => {
  it("shows a trigger nobody touched as off, without route or secret", async () => {
    const rig = await createTriggerRig();
    expect(await rig.triggers.get(rig.graph.id, WEBHOOK_TRIGGER)).toEqual({
      triggerId: WEBHOOK_TRIGGER,
      hookId: null,
      enabled: false,
      secretSetAt: null,
      lastFiredAt: null,
      lastOutcome: null,
      lastNote: null,
      lastRunId: null,
      nextRunAt: null,
    });
  });

  it("rejects a graph that does not exist", async () => {
    const rig = await createTriggerRig();
    const unknown = randomUUID();
    await expect(rig.triggers.get(unknown, "t")).rejects.toBeInstanceOf(GraphNotFoundError);
    await expect(rig.triggers.rotateSecret(unknown, "t")).rejects.toBeInstanceOf(
      GraphNotFoundError,
    );
    await expect(rig.triggers.setEnabled(unknown, "t", true)).rejects.toBeInstanceOf(
      GraphNotFoundError,
    );
  });

  describe("webhook secret", () => {
    it("is generated with an opaque route and stored only encrypted", async () => {
      const rig = await createTriggerRig();

      const { secret, view } = await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);

      expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      expect(view.hookId).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(view.hookId).not.toContain(rig.graph.id);
      expect(view.hookId).not.toContain(WEBHOOK_TRIGGER);
      expect(view.secretSetAt).toBeInstanceOf(Date);

      const stored = rig.secretRepository.stored.get(webhookSecretName(view.hookId!));
      expect(stored?.ciphertext.toString("utf8")).not.toContain(secret);
      expect(await rig.secrets.get(webhookSecretName(view.hookId!))).toBe(secret);
    });

    it("is replaced on rotation, keeping the same route", async () => {
      const rig = await createTriggerRig();
      const first = await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);
      const second = await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);

      expect(second.secret).not.toBe(first.secret);
      expect(second.view.hookId).toBe(first.view.hookId);
      expect(await rig.secrets.get(webhookSecretName(first.view.hookId!))).toBe(second.secret);
    });

    it("is never part of what get() shows afterwards", async () => {
      const rig = await createTriggerRig();
      const { secret } = await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);

      const later = await rig.triggers.get(rig.graph.id, WEBHOOK_TRIGGER);

      expect(JSON.stringify(later)).not.toContain(secret);
      expect(later.secretSetAt).toBeInstanceOf(Date);
    });

    it("creates nothing when there is no master key", async () => {
      const rig = await createTriggerRig();
      const noKey = new SecretsService(
        new InMemorySecretRepository(),
        new UnavailableSecretCipher(),
      );
      const triggers = new TriggersService(rig.graphs, rig.states, noKey, rig.launcher);

      await expect(triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER)).rejects.toMatchObject({
        code: "master_key_not_configured",
      });
      expect(await rig.states.find(rig.graph.id, WEBHOOK_TRIGGER)).toBeUndefined();
    });
  });

  describe("turning on", () => {
    it("needs a published version", async () => {
      const rig = await createTriggerRig();
      await expect(
        rig.triggers.setEnabled(rig.graph.id, SCHEDULE_TRIGGER, true),
      ).rejects.toMatchObject({ code: "no_published_version" });
    });

    it("needs the trigger in the latest version as a webhook or a schedule", async () => {
      const rig = await createTriggerRig();
      await rig.publish();
      await expect(rig.triggers.setEnabled(rig.graph.id, "nao-existe", true)).rejects.toMatchObject(
        {
          code: "trigger_not_in_version",
        },
      );
    });

    it("needs the secret first, for a webhook", async () => {
      const rig = await createTriggerRig();
      await rig.publish();
      await expect(
        rig.triggers.setEnabled(rig.graph.id, WEBHOOK_TRIGGER, true),
      ).rejects.toMatchObject({ code: "webhook_secret_required" });

      await rig.triggers.rotateSecret(rig.graph.id, WEBHOOK_TRIGGER);
      expect((await rig.triggers.setEnabled(rig.graph.id, WEBHOOK_TRIGGER, true)).enabled).toBe(
        true,
      );
    });

    it("needs nothing else for a schedule, and tells the scheduler", async () => {
      const rig = await createTriggerRig();
      await rig.publish();
      const changes: string[] = [];
      rig.triggers.onChange(({ triggerId }) => {
        changes.push(triggerId);
        return Promise.resolve();
      });

      const view = await rig.triggers.setEnabled(rig.graph.id, SCHEDULE_TRIGGER, true);

      expect(view.enabled).toBe(true);
      expect(changes).toEqual([SCHEDULE_TRIGGER]);
    });
  });

  it("turns off without needing anything, and an untouched trigger stays untouched", async () => {
    const rig = await createTriggerRig();
    const view = await rig.triggers.setEnabled(rig.graph.id, WEBHOOK_TRIGGER, false);
    expect(view.enabled).toBe(false);
    expect(await rig.states.find(rig.graph.id, WEBHOOK_TRIGGER)).toBeUndefined();
  });
});
