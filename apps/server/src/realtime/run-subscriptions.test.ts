import { beforeEach, describe, expect, it } from "vitest";
import type { RunEventHistory } from "./run-event-history.js";
import type { EventSink, RunEvent } from "./run-event.js";
import { RunSubscriptions } from "./run-subscriptions.js";

const RUN = "0192f1c0-0000-7000-8000-000000000001";
const OTHER_RUN = "0192f1c0-0000-7000-8000-000000000002";

const event = (seq: number, runId = RUN): RunEvent => ({
  runId,
  seq,
  type: "message.sent",
  agent: null,
  payload: { seq },
  at: new Date(0),
});

class RecordingSink implements EventSink {
  readonly received: RunEvent[] = [];

  send(sent: RunEvent): void {
    this.received.push(sent);
  }

  get seqs(): number[] {
    return this.received.map((e) => e.seq);
  }
}

/** History backed by a list; `gate` lets a test publish while the replay is still pending. */
class FakeHistory implements RunEventHistory {
  events: RunEvent[] = [];
  gate: Promise<void> | undefined;
  failure: Error | undefined;

  async readFrom(runId: string, fromSeq: number): Promise<RunEvent[]> {
    await this.gate;
    if (this.failure) throw this.failure;
    return this.events.filter((e) => e.runId === runId && e.seq >= fromSeq);
  }
}

describe("RunSubscriptions", () => {
  let history: FakeHistory;
  let subscriptions: RunSubscriptions;

  beforeEach(() => {
    history = new FakeHistory();
    subscriptions = new RunSubscriptions(history);
  });

  it("delivers live events only to subscribers of that run", async () => {
    const listening = new RecordingSink();
    const elsewhere = new RecordingSink();
    await subscriptions.subscribe(listening, RUN);
    await subscriptions.subscribe(elsewhere, OTHER_RUN);

    subscriptions.publish(event(1));
    subscriptions.publish(event(2));

    expect(listening.seqs).toEqual([1, 2]);
    expect(elsewhere.received).toEqual([]);
  });

  it("delivers to every subscriber of the run", async () => {
    const a = new RecordingSink();
    const b = new RecordingSink();
    await subscriptions.subscribe(a, RUN);
    await subscriptions.subscribe(b, RUN);

    subscriptions.publish(event(1));

    expect([a.seqs, b.seqs]).toEqual([[1], [1]]);
  });

  it("does not replay history when no fromSeq is given", async () => {
    history.events = [event(1), event(2)];
    const sink = new RecordingSink();

    await subscriptions.subscribe(sink, RUN);

    expect(sink.received).toEqual([]);
  });

  it("replays from fromSeq (inclusive), then continues live", async () => {
    history.events = [event(1), event(2), event(3)];
    const sink = new RecordingSink();

    await subscriptions.subscribe(sink, RUN, 2);
    subscriptions.publish(event(4));

    expect(sink.seqs).toEqual([2, 3, 4]);
  });

  it("buffers events published during the replay, in order and without duplicates", async () => {
    history.events = [event(1), event(2)];
    let release!: () => void;
    history.gate = new Promise((resolve) => (release = resolve));
    const sink = new RecordingSink();

    const subscribing = subscriptions.subscribe(sink, RUN, 1);
    subscriptions.publish(event(4));
    subscriptions.publish(event(3));
    subscriptions.publish(event(2)); // already part of the replayed history
    expect(sink.received).toEqual([]);
    release();
    await subscribing;
    subscriptions.publish(event(5));

    expect(sink.seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops events older than what the sink already received", async () => {
    const sink = new RecordingSink();
    await subscriptions.subscribe(sink, RUN, 5);

    subscriptions.publish(event(3));
    subscriptions.publish(event(5));
    subscriptions.publish(event(5));
    subscriptions.publish(event(6));

    expect(sink.seqs).toEqual([5, 6]);
  });

  it("stops delivering after unsubscribe, without affecting other subscribers", async () => {
    const leaving = new RecordingSink();
    const staying = new RecordingSink();
    await subscriptions.subscribe(leaving, RUN);
    await subscriptions.subscribe(staying, RUN);

    subscriptions.unsubscribe(leaving, RUN);
    subscriptions.publish(event(1));

    expect(leaving.received).toEqual([]);
    expect(staying.seqs).toEqual([1]);
  });

  it("stops delivering every run to a sink that disconnects", async () => {
    const sink = new RecordingSink();
    await subscriptions.subscribe(sink, RUN);
    await subscriptions.subscribe(sink, OTHER_RUN);

    subscriptions.unsubscribeAll(sink);
    subscriptions.publish(event(1));
    subscriptions.publish(event(1, OTHER_RUN));

    expect(sink.received).toEqual([]);
  });

  it("restarts from the new resume point when subscribing again to the same run", async () => {
    history.events = [event(1), event(2), event(3)];
    const sink = new RecordingSink();
    await subscriptions.subscribe(sink, RUN, 1);

    await subscriptions.subscribe(sink, RUN, 3);

    expect(sink.seqs).toEqual([1, 2, 3, 3]);
  });

  it("drops the subscription and surfaces the error when history cannot be read", async () => {
    history.failure = new Error("db down");
    const sink = new RecordingSink();

    await expect(subscriptions.subscribe(sink, RUN, 1)).rejects.toThrow("db down");
    subscriptions.publish(event(1));

    expect(sink.received).toEqual([]);
  });

  it("ignores events of runs nobody listens to", () => {
    expect(() => subscriptions.publish(event(1))).not.toThrow();
  });
});
