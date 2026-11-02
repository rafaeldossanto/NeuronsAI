import { Inject, Injectable } from "@nestjs/common";
import { Hub } from "../hub/hub.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { Signal } from "../shared/signal.js";
import { GuardEvents } from "./guard-events.js";
import type { GuardTrip } from "./guard-trip.js";

/**
 * Where every guard reports a trip. It writes the `GuardTripped` event first, so the log says
 * why before anything is stopped, and then announces the trip: the run service ends the run for a
 * run-wide trip, the supervisor stops the agent for an agent trip. A guard trips once per run (and
 * agent): the same limit being crossed again by messages already in flight is not news.
 */
@Injectable()
export class GuardEnforcer {
  /** A guard tripped and its event is in the log: stop what it names. */
  readonly tripped = new Signal<GuardTrip>();

  private readonly seen = new Set<string>();

  constructor(
    @Inject(Hub) hub: Hub,
    @Inject(RunEventRecorder) private readonly recorder: RunEventRecorder,
  ) {
    hub.guardTripped.subscribe((trip) => this.trip(trip));
  }

  async trip(trip: GuardTrip): Promise<void> {
    const key = `${trip.runId}\u0000${trip.guard}\u0000${trip.agent ?? ""}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    await this.recorder.record(trip.runId, [GuardEvents.tripped(trip)]);
    this.tripped.emit(trip);
  }

  /** The run is over: its trips no longer need remembering. */
  forget(runId: string): void {
    for (const key of this.seen) if (key.startsWith(`${runId}\u0000`)) this.seen.delete(key);
  }
}
