import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageKind } from "../database/schema/index.js";
import { HUMAN, TRIGGER } from "./addresses.js";
import { allow, deny, type MessagePolicy } from "./message-policy.js";
import {
  AskTimeoutError,
  InvalidMessageError,
  MessageDeniedError,
  MessageNotFoundError,
  RunNotActiveError,
} from "./hub.errors.js";
import { createHubHarness, inMemoryPersistence } from "./testing/hub-harness.js";
import { eventually } from "./testing/async-helpers.js";

/** Alfa -> Beta (one way), Beta <-> Gama, Delta alone: see test-graph.ts. */
describe("Hub.send", () => {
  let persistence: ReturnType<typeof inMemoryPersistence>;
  let harness: ReturnType<typeof createHubHarness>;
  let runId: string;

  beforeEach(async () => {
    persistence = inMemoryPersistence();
    harness = createHubHarness(persistence);
    runId = await harness.openRun();
  });

  const send = (from: string, to: string, kind: MessageKind, body: string, replyTo?: string) =>
    harness.hub.send(runId, from, to, kind, body, replyTo);
  const sentEvents = () => harness.published.filter((event) => event.type === "MessageSent");

  describe("permission", () => {
    it("lets an agent write to a peer it has an arrow to", async () => {
      const message = await send("Alfa", "Beta", "message", "oi");

      expect(message).toMatchObject({ from: "Alfa", to: "Beta", kind: "message", body: "oi" });
      expect(persistence.messageStore.allOf(runId)).toHaveLength(1);
    });

    it("denies a peer without an arrow and stores and publishes nothing", async () => {
      await expect(send("Alfa", "Gama", "message", "oi")).rejects.toMatchObject({
        constructor: MessageDeniedError,
        code: "message_not_permitted",
        kind: "forbidden",
      });

      expect(persistence.messageStore.allOf(runId)).toEqual([]);
      expect(harness.published).toEqual([]);
    });

    it("denies the opposite direction of a one-way arrow", async () => {
      await expect(send("Beta", "Alfa", "message", "oi")).rejects.toBeInstanceOf(
        MessageDeniedError,
      );
    });

    it("allows both directions of a bidirectional arrow", async () => {
      await send("Beta", "Gama", "message", "ida");
      await send("Gama", "Beta", "message", "volta");

      expect(persistence.messageStore.allOf(runId).map((m) => m.body)).toEqual(["ida", "volta"]);
    });

    it.each([HUMAN, TRIGGER])("lets %s write to any agent, arrow or not", async (sender) => {
      await send(sender, "Delta", "message", "oi");

      expect(persistence.messageStore.allOf(runId)).toMatchObject([{ from: sender, to: "Delta" }]);
    });

    it("lets the recipient answer whoever wrote, even without an arrow back", async () => {
      const original = await send("Alfa", "Beta", "ask", "pergunta");

      const answer = await send("Beta", "Alfa", "reply", "resposta", original.id);

      expect(answer).toMatchObject({ kind: "reply", replyTo: original.id, to: "Alfa" });
    });

    it("refuses a reply from someone the original was not addressed to", async () => {
      const original = await send("Alfa", "Beta", "message", "oi");

      await expect(send("Gama", "Alfa", "reply", "intruso", original.id)).rejects.toMatchObject({
        constructor: MessageDeniedError,
        code: "reply_not_allowed",
      });
    });

    it("refuses a reply addressed to someone other than who wrote the original", async () => {
      const original = await send("Alfa", "Beta", "message", "oi");

      await expect(send("Beta", "Gama", "reply", "desvio", original.id)).rejects.toBeInstanceOf(
        MessageDeniedError,
      );
    });

    it("lets an agent answer a human, and stores that answer as already delivered", async () => {
      const question = await send(HUMAN, "Beta", "message", "como vai?");

      const answer = await send("Beta", HUMAN, "reply", "bem", question.id);

      expect(answer).toMatchObject({ to: HUMAN });
      expect(answer.ackedAt).not.toBeNull();
      expect(await persistence.messageStore.findNextPending(runId, HUMAN)).toBeUndefined();
    });

    it("does not let an agent start a conversation with the human", async () => {
      await expect(send("Beta", HUMAN, "message", "oi")).rejects.toMatchObject({
        constructor: InvalidMessageError,
        code: "unknown_recipient",
      });
    });
  });

  describe("policy chain", () => {
    const refuseEverything: MessagePolicy = { evaluate: () => deny("custom_limit", "Limite.") };

    it("applies the policies after the permission, in order, and stops at the first refusal", async () => {
      const second = { evaluate: vi.fn(() => allow()) };
      harness = createHubHarness(persistence, { extraPolicies: [refuseEverything, second] });
      runId = await harness.openRun();

      await expect(send("Alfa", "Beta", "message", "oi")).rejects.toMatchObject({
        code: "custom_limit",
        message: "Limite.",
      });
      expect(second.evaluate).not.toHaveBeenCalled();
    });

    it("does not consult later policies when the permission already refused", async () => {
      const later = { evaluate: vi.fn(() => allow()) };
      harness = createHubHarness(persistence, { extraPolicies: [later] });
      runId = await harness.openRun();

      await expect(send("Alfa", "Gama", "message", "oi")).rejects.toMatchObject({
        code: "message_not_permitted",
      });
      expect(later.evaluate).not.toHaveBeenCalled();
    });

    it("hands the graph, the sender and the answered message to the policies", async () => {
      const spy = { evaluate: vi.fn(() => allow()) };
      harness = createHubHarness(persistence, { extraPolicies: [spy] });
      runId = await harness.openRun();
      const original = await send("Alfa", "Beta", "message", "oi");

      await send("Beta", "Alfa", "reply", "ok", original.id);

      expect(spy.evaluate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          runId,
          from: "Beta",
          to: "Alfa",
          kind: "reply",
          replyTo: original,
        }),
      );
    });
  });

  describe("validation", () => {
    it("refuses an unknown recipient", async () => {
      await expect(send("Alfa", "Fantasma", "message", "oi")).rejects.toMatchObject({
        constructor: InvalidMessageError,
        code: "unknown_recipient",
      });
    });

    it("refuses an unknown sender", async () => {
      await expect(send("Fantasma", "Beta", "message", "oi")).rejects.toMatchObject({
        code: "unknown_sender",
      });
    });

    it("requires a reply to say what it answers, and only a reply may", async () => {
      await expect(send("Beta", "Alfa", "reply", "x")).rejects.toMatchObject({
        code: "reply_without_target",
      });
      const original = await send("Alfa", "Beta", "message", "oi");
      await expect(send("Alfa", "Beta", "message", "x", original.id)).rejects.toMatchObject({
        code: "unexpected_reply_to",
      });
    });

    it("refuses to answer a message that does not exist in the run", async () => {
      await expect(
        send("Beta", "Alfa", "reply", "x", "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(MessageNotFoundError);
    });

    it("refuses to send in a run that is not active", async () => {
      await expect(
        harness.hub.send("run-inexistente", "Alfa", "Beta", "message", "oi"),
      ).rejects.toBeInstanceOf(RunNotActiveError);
    });
  });

  describe("storing and publishing", () => {
    it("stores the message and its MessageSent event together, with consecutive seqs", async () => {
      await send(HUMAN, "Beta", "message", "um");
      await send(HUMAN, "Beta", "message", "dois");

      const events = persistence.runLog.eventsOf(runId, "MessageSent");
      // The message takes the seq of its own event; other events (AgentStarted...) fill the rest.
      expect(persistence.messageStore.allOf(runId).map((m) => m.seq)).toEqual(
        events.map((event) => event.seq),
      );
      expect(events[0]?.seq).toBeLessThan(events[1]!.seq);
      expect(events[0]?.payload).toMatchObject({ from: HUMAN, to: "Beta", body: "um" });
    });

    it("publishes only after the message is stored", async () => {
      const store = persistence.messageStore;
      const append = store.append.bind(store);
      let publishedBeforeCommit: number | undefined;
      store.append = async (...args) => {
        const stored = await append(...args);
        publishedBeforeCommit = harness.published.length;
        return stored;
      };

      await send(HUMAN, "Beta", "message", "oi");

      expect(publishedBeforeCommit).toBe(0);
      expect(sentEvents()).toHaveLength(1);
    });
  });

  describe("delivery", () => {
    it("starts the recipient on its first message and hands it over at once", async () => {
      const message = await send("Alfa", "Beta", "message", "oi");

      await eventually(() => {
        expect(harness.runtimes.runtimeOf("Beta")?.received).toMatchObject([
          { id: message.id, from: "Alfa", kind: "message", body: "oi", replyTo: null },
        ]);
      });
      await eventually(async () => {
        expect(await persistence.messageStore.findById(message.id)).toMatchObject({
          deliveredAt: expect.any(Date) as Date,
          ackedAt: expect.any(Date) as Date,
        });
      });
      expect(harness.published.map((event) => event.type)).toEqual(
        expect.arrayContaining(["MessageSent", "AgentStarted", "MessageDelivered"]),
      );
    });

    it("keeps messages for a busy recipient and hands them over in order when it is idle", async () => {
      harness.runtimes.setScript("Beta", (turn) => turn.work(40));
      await send("Alfa", "Beta", "message", "primeira");
      await eventually(() => expect(harness.runtimes.runtimeOf("Beta")?.state).toBe("busy"));

      await send("Alfa", "Beta", "message", "segunda");
      await send("Alfa", "Beta", "message", "terceira");

      const queued = persistence.messageStore.allOf(runId).filter((m) => m.body !== "primeira");
      expect(queued.map((m) => m.deliveredAt)).toEqual([null, null]);
      expect(harness.runtimes.runtimeOf("Beta")?.received).toHaveLength(1);

      await eventually(() => {
        expect(harness.runtimes.runtimeOf("Beta")?.received.map((m) => m.body)).toEqual([
          "primeira",
          "segunda",
          "terceira",
        ]);
      });
    });

    it("starts each agent only once", async () => {
      await send("Alfa", "Beta", "message", "um");
      await send("Alfa", "Beta", "message", "dois");
      await eventually(() => expect(harness.runtimes.runtimeOf("Beta")?.received).toHaveLength(2));

      expect(harness.runtimes.created.map((runtime) => runtime.name)).toEqual(["Beta"]);
      expect(harness.published.filter((event) => event.type === "AgentStarted")).toHaveLength(1);
    });
  });

  describe("ask", () => {
    it("resolves with the text of the matching reply and puts the asker in waiting_reply", async () => {
      let answer: string | undefined;
      harness.runtimes.setScript("Alfa", async (turn) => {
        answer = await turn.ask("Beta", "quanto é 6x7?");
      });
      harness.runtimes.setScript("Beta", async (turn) => {
        await turn.work(40);
        await turn.reply("42");
      });

      await send(TRIGGER, "Alfa", "message", "comece");

      await eventually(() =>
        expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("waiting_reply"),
      );
      await eventually(() => expect(answer).toBe("42"));
      // The answer settled the ask; it was not handed to the runtime as a new message.
      expect(harness.runtimes.runtimeOf("Alfa")?.received.map((m) => m.kind)).toEqual(["message"]);
      const reply = persistence.messageStore.allOf(runId).find((m) => m.kind === "reply");
      expect(reply?.ackedAt).not.toBeNull();
    });

    it("rejects with AskTimeoutError when nobody answers in time", async () => {
      const outcome = harness.hub.ask(runId, HUMAN, "Beta", "alguém aí?", 30);

      await expect(outcome).rejects.toBeInstanceOf(AskTimeoutError);
    });

    it("uses the configured default timeout", async () => {
      harness = createHubHarness(persistence, { hub: { askTimeoutMs: 20 } });
      runId = await harness.openRun();

      await expect(harness.hub.ask(runId, HUMAN, "Beta", "alguém aí?")).rejects.toBeInstanceOf(
        AskTimeoutError,
      );
    });

    it("hands a late answer to the asker as an ordinary message", async () => {
      harness.runtimes.setScript("Alfa", async (turn) => {
        if (turn.message.kind === "message") {
          await turn.ask("Beta", "pergunta", { timeoutMs: 20 }).catch(() => undefined);
        }
      });
      const askMessageId = new Promise<string>((resolve) => {
        harness.runtimes.setScript("Beta", async (turn) => {
          await turn.work(80);
          resolve(turn.message.id);
          await turn.reply("tarde demais");
        });
      });

      await send(TRIGGER, "Alfa", "message", "comece");

      await eventually(() => {
        expect(harness.runtimes.runtimeOf("Alfa")?.received.map((m) => [m.kind, m.body])).toEqual([
          ["message", "comece"],
          ["reply", "tarde demais"],
        ]);
      });
      expect(await askMessageId).toBeDefined();
    });
  });
});
