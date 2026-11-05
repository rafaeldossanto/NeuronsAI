import type {
  TriggerStatePatch,
  TriggerStateRecord,
  TriggerStateRepository,
} from "../trigger-state.js";

const keyOf = (graphId: string, triggerId: string) => `${graphId}/${triggerId}`;

export class InMemoryTriggerStateRepository implements TriggerStateRepository {
  private readonly records = new Map<string, TriggerStateRecord>();
  private readonly deliveries = new Map<string, Date>();

  ensure(graphId: string, triggerId: string, hookId: string): Promise<TriggerStateRecord> {
    const existing = this.records.get(keyOf(graphId, triggerId));
    if (existing) return Promise.resolve(existing);
    const record: TriggerStateRecord = {
      graphId,
      triggerId,
      hookId,
      enabled: false,
      secretSetAt: null,
      lastFiredAt: null,
      lastOutcome: null,
      lastNote: null,
      lastRunId: null,
      nextRunAt: null,
    };
    this.records.set(keyOf(graphId, triggerId), record);
    return Promise.resolve(record);
  }

  find(graphId: string, triggerId: string): Promise<TriggerStateRecord | undefined> {
    return Promise.resolve(this.records.get(keyOf(graphId, triggerId)));
  }

  findByHookId(hookId: string): Promise<TriggerStateRecord | undefined> {
    return Promise.resolve([...this.records.values()].find((record) => record.hookId === hookId));
  }

  update(graphId: string, triggerId: string, patch: TriggerStatePatch): Promise<void> {
    const key = keyOf(graphId, triggerId);
    const record = this.records.get(key);
    if (record) this.records.set(key, { ...record, ...patch });
    return Promise.resolve();
  }

  listEnabled(): Promise<TriggerStateRecord[]> {
    return Promise.resolve([...this.records.values()].filter((record) => record.enabled));
  }

  recordDelivery(hookId: string, signature: string, receivedAt: Date): Promise<boolean> {
    const key = `${hookId}/${signature}`;
    if (this.deliveries.has(key)) return Promise.resolve(false);
    this.deliveries.set(key, receivedAt);
    return Promise.resolve(true);
  }

  purgeDeliveries(receivedBefore: Date): Promise<void> {
    for (const [key, at] of this.deliveries) if (at < receivedBefore) this.deliveries.delete(key);
    return Promise.resolve();
  }
}
