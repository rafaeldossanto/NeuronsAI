import { expect, it } from "vitest";
import { accountSessions, memberships } from "../database/schema/accounts.js";
import type { DatabaseService } from "../database/database.service.js";
import { InvalidSessionError } from "./account.errors.js";
import { AccountSessionsService } from "./account-sessions.service.js";

const TOKEN = `nsa_${"a".repeat(43)}`;
const NOW = new Date("2026-01-01T00:00:00Z");

/** Fake database: one session row and a membership list that the test can change between calls. */
function fakeDatabase() {
  const state = {
    members: [{ userId: "u1", organizationId: "o1", role: "member" }] as object[],
    membershipReads: 0,
  };
  const session = {
    id: "s1",
    userId: "u1",
    organizationId: "o1",
    accessExpiresAt: new Date(NOW.getTime() + 60_000),
    expiresAt: new Date(NOW.getTime() + 120_000),
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === accountSessions) return Promise.resolve([session]);
          if (table === memberships) {
            state.membershipReads += 1;
            return Promise.resolve(state.members);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  };
  return { state, database: { db } as unknown as DatabaseService };
}

it("rereads the membership on every authentication, so a revocation applies at once", async () => {
  const { state, database } = fakeDatabase();
  const sessions = new AccountSessionsService(database, () => NOW);

  await expect(sessions.authenticate(TOKEN)).resolves.toMatchObject({ role: "member" });
  await expect(sessions.authenticate(TOKEN)).resolves.toMatchObject({ role: "member" });
  expect(state.membershipReads).toBe(2); // exactly one read per request, never cached

  state.members = []; // the member is removed between two requests
  await expect(sessions.authenticate(TOKEN)).rejects.toBeInstanceOf(InvalidSessionError);
});

it("applies a role downgrade on the very next authentication", async () => {
  const { state, database } = fakeDatabase();
  const sessions = new AccountSessionsService(database, () => NOW);
  await expect(sessions.authenticate(TOKEN)).resolves.toMatchObject({ role: "member" });
  state.members = [{ userId: "u1", organizationId: "o1", role: "viewer" }];
  await expect(sessions.authenticate(TOKEN)).resolves.toMatchObject({ role: "viewer" });
});
