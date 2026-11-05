export interface RunnerRecord {
  organizationId?: string | null;
  id: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export interface RunnerRepository {
  /** @throws RunnerNameTakenError when a runner with this name exists. */
  create(input: { name: string; tokenHash: string }): Promise<RunnerRecord>;
  findByTokenHash(tokenHash: string): Promise<RunnerRecord | undefined>;
  findById(id: string): Promise<RunnerRecord | undefined>;
  /** Marks the runner as revoked; false when there is no such runner or it already was. */
  revokeByName(name: string): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
  list(): Promise<RunnerRecord[]>;
}

export const RUNNER_REPOSITORY = Symbol("RUNNER_REPOSITORY");
