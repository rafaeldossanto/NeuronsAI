import { Inject, Injectable } from "@nestjs/common";
import { generateRunnerToken, hashRunnerToken } from "./runner-token.js";
import {
  RUNNER_REPOSITORY,
  type RunnerRecord,
  type RunnerRepository,
} from "./runner-repository.js";

export interface IssuedRunner {
  id: string;
  name: string;
  /** Shown once, here: only its hash is kept. */
  token: string;
}

export interface RunnerIdentity {
  organizationId?: string | null;
  /** The user a personal runner belongs to; absent for a runner of the organization (and the embedded one). */
  ownerUserId?: string | null;
  id: string;
  name: string;
}

/** Issues, checks and revokes the tokens that let a runner connect. */
@Injectable()
export class RunnerTokens {
  constructor(@Inject(RUNNER_REPOSITORY) private readonly runners: RunnerRepository) {}

  /** @throws RunnerNameTakenError */
  async issue(name: string): Promise<IssuedRunner> {
    const token = generateRunnerToken();
    const record = await this.runners.create({ name, tokenHash: hashRunnerToken(token) });
    return { id: record.id, name: record.name, token };
  }

  /**
   * The personal runner of `ownerUserId` named `name`, in the current organization. A user who
   * already has one with this name (revoked or not) gets the same runner back with a new token: the
   * old one stops working.
   */
  async issuePersonal(ownerUserId: string, name: string): Promise<IssuedRunner> {
    const token = generateRunnerToken();
    const record = await this.runners.upsertPersonal({
      ownerUserId,
      name,
      tokenHash: hashRunnerToken(token),
    });
    return { id: record.id, name: record.name, token };
  }

  /** Who the token belongs to, or nothing when it is unknown or revoked. */
  async authenticate(token: string): Promise<RunnerIdentity | undefined> {
    const record = await this.runners.findByTokenHash(hashRunnerToken(token));
    if (!record || record.revokedAt) return undefined;
    return {
      id: record.id,
      name: record.name,
      ...(record.organizationId && { organizationId: record.organizationId }),
      ...(record.ownerUserId && { ownerUserId: record.ownerUserId }),
    };
  }

  /** Whether the runner may stay connected (it was not revoked since it connected). */
  async isActive(id: string): Promise<boolean> {
    const record = await this.runners.findById(id);
    return record !== undefined && record.revokedAt === null;
  }

  markSeen(id: string): Promise<void> {
    return this.runners.touch(id, new Date());
  }

  revoke(name: string): Promise<boolean> {
    return this.runners.revokeByName(name);
  }

  /** Revokes a personal runner; false unless it is `ownerUserId`'s. */
  revokePersonal(id: string, ownerUserId: string): Promise<boolean> {
    return this.runners.revokePersonal(id, ownerUserId);
  }

  /** The runners of the organization (personal ones are not listed here). */
  list(): Promise<RunnerRecord[]> {
    return this.runners.list();
  }

  listPersonal(ownerUserId: string): Promise<RunnerRecord[]> {
    return this.runners.listPersonal(ownerUserId);
  }
}
