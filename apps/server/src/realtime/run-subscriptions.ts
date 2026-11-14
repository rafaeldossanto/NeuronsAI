import { Inject, Injectable } from "@nestjs/common";
import { RUN_EVENT_HISTORY, type RunEventHistory } from "./run-event-history.js";
import type { EphemeralRunEvent, EventSink, RunEvent } from "./run-event.js";

const REPLAY_BATCH = 1000;

interface Subscription {
  /** Lowest seq still owed to the sink; undefined until the first event when no resume point was given. */
  nextSeq: number | undefined;
  /** Live events that arrived while history was being replayed. */
  buffered: RunEvent[] | undefined;
}

/**
 * Who listens to which run. Pure delivery logic, free of any transport: it replays history
 * from a resume point, then switches to live events without duplicates or reordering.
 */
@Injectable()
export class RunSubscriptions {
  private readonly subscriptions = new Map<string, Map<EventSink, Subscription>>();

  constructor(
    @Inject(RUN_EVENT_HISTORY) private readonly history: Pick<RunEventHistory, "readFrom">,
  ) {}

  /**
   * Subscribes the sink to a run. With `fromSeq`, events from that seq onwards are replayed first.
   * Subscribing again to the same run restarts the subscription from the new resume point.
   */
  async subscribe(sink: EventSink, runId: string, fromSeq?: number): Promise<void> {
    const subscription: Subscription = {
      nextSeq: fromSeq,
      buffered: fromSeq === undefined ? undefined : [],
    };
    this.forRun(runId).set(sink, subscription);
    if (fromSeq === undefined) return;

    try {
      // In batches, so a long log is never held in memory whole; `seq` keeps the order.
      let next = fromSeq;
      for (;;) {
        const batch = await this.history.readFrom(runId, next, REPLAY_BATCH);
        for (const event of batch) this.deliver(sink, subscription, event);
        if (batch.length < REPLAY_BATCH) break;
        next = batch[batch.length - 1]!.seq + 1;
      }
    } catch (error) {
      this.unsubscribe(sink, runId);
      throw error;
    }
    const buffered = subscription.buffered ?? [];
    subscription.buffered = undefined;
    for (const event of buffered.sort((a, b) => a.seq - b.seq))
      this.deliver(sink, subscription, event);
  }

  unsubscribe(sink: EventSink, runId: string): void {
    const sinks = this.subscriptions.get(runId);
    sinks?.delete(sink);
    if (sinks?.size === 0) this.subscriptions.delete(runId);
  }

  /** Call when the connection closes. */
  unsubscribeAll(sink: EventSink): void {
    for (const runId of [...this.subscriptions.keys()]) this.unsubscribe(sink, runId);
  }

  /** Pushes a freshly recorded event to everyone subscribed to its run. */
  publish(event: RunEvent): void {
    for (const [sink, subscription] of this.subscriptions.get(event.runId) ?? []) {
      if (subscription.buffered) subscription.buffered.push(event);
      else this.deliver(sink, subscription, event);
    }
  }

  /** Pushes a live-only event to everyone subscribed to its run; nothing is buffered or replayed. */
  publishEphemeral(event: EphemeralRunEvent): void {
    for (const sink of this.subscriptions.get(event.runId)?.keys() ?? []) sink.sendEphemeral(event);
  }

  private deliver(sink: EventSink, subscription: Subscription, event: RunEvent): void {
    if (subscription.nextSeq !== undefined && event.seq < subscription.nextSeq) return;
    subscription.nextSeq = event.seq + 1;
    sink.send(event);
  }

  private forRun(runId: string): Map<EventSink, Subscription> {
    let sinks = this.subscriptions.get(runId);
    if (!sinks) {
      sinks = new Map();
      this.subscriptions.set(runId, sinks);
    }
    return sinks;
  }
}
