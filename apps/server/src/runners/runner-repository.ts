export interface RunnerRecord {
  organizationId?: string | null;
  /** The user a personal runner belongs to; absent or null is a runner of the organization. */
  ownerUserId?: string | null;
  id: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export interface RunnerRepository {
  /**
   * A runner of the current organization (no owner).
   * @throws RunnerNameTakenError when one with this name exists.
   */
  create(input: { name: string; tokenHash: string }): Promise<RunnerRecord>;
  /**
   * The personal runner of `ownerUserId` in the current organization. When this user already has one
   * with this name (revoked or not), it keeps its id and gets the new token, active again.
   */
  upsertPersonal(input: {
    ownerUserId: string;
    name: string;
    tokenHash: string;
  }): Promise<RunnerRecord>;
  findByTokenHash(tokenHash: string): Promise<RunnerRecord | undefined>;
  findById(id: string): Promise<RunnerRecord | undefined>;
  /** Marks the runner of the organization as revoked; false when there is none or it already was. */
  revokeByName(name: string): Promise<boolean>;
  /** Revokes a personal runner of this user; false when it is not theirs (or does not exist). */
  revokePersonal(id: string, ownerUserId: string): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
  /** The runners of the current organization, personal ones left out. */
  list(): Promise<RunnerRecord[]>;
  /** The personal runners of this user in the current organization. */
  listPersonal(ownerUserId: string): Promise<RunnerRecord[]>;
}

export const RUNNER_REPOSITORY = Symbol("RUNNER_REPOSITORY");
