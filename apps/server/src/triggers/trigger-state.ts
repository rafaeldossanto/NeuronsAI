export const TRIGGER_OUTCOMES = ["started", "skipped_overlap", "skipped_missed", "failed"] as const;
export type TriggerOutcome = (typeof TRIGGER_OUTCOMES)[number];

export interface TriggerStateRecord {
  /** Populated by the database for trusted background jobs/webhook lookup. */
  organizationId?: string | null;
  graphId: string;
  triggerId: string;
  /** Opaque id of the public webhook URL. */
  hookId: string;
  enabled: boolean;
  secretSetAt: Date | null;
  lastFiredAt: Date | null;
  lastOutcome: TriggerOutcome | null;
  lastNote: string | null;
  lastRunId: string | null;
  nextRunAt: Date | null;
}

export type TriggerStatePatch = Partial<
  Pick<
    TriggerStateRecord,
    | "enabled"
    | "secretSetAt"
    | "lastFiredAt"
    | "lastOutcome"
    | "lastNote"
    | "lastRunId"
    | "nextRunAt"
  >
>;

export interface TriggerStateRepository {
  /** Creates the state with this `hookId` when the trigger has none yet; returns the stored one. */
  ensure(graphId: string, triggerId: string, hookId: string): Promise<TriggerStateRecord>;
  find(graphId: string, triggerId: string): Promise<TriggerStateRecord | undefined>;
  findByHookId(hookId: string): Promise<TriggerStateRecord | undefined>;
  update(graphId: string, triggerId: string, patch: TriggerStatePatch): Promise<void>;
  listEnabled(): Promise<TriggerStateRecord[]>;
  /**
   * Remembers an accepted request's signature. False when it was already there: the request is a
   * replay. Atomic, so two identical requests at once cannot both pass.
   */
  recordDelivery(hookId: string, signature: string, receivedAt: Date): Promise<boolean>;
  purgeDeliveries(receivedBefore: Date): Promise<void>;
}

export const TRIGGER_STATE_REPOSITORY = Symbol("TRIGGER_STATE_REPOSITORY");
