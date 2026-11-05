import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accountSessions,
  identities,
  memberships,
  organizations,
  refreshCredentials,
  users,
} from "../database/schema/accounts.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { AccountsService, type AccountUser } from "./accounts.service.js";
import { InvalidSessionError, LastOwnerError, OrganizationAccessError } from "./account.errors.js";
import type { VerifiedIdentity } from "./identity-provider.js";

let testDb: TestDatabase;
let accounts: AccountsService;
let sessions: AccountSessionsService;
let alice: AccountUser;
let bob: AccountUser;
let organizationId: string;
let bobOrganizationId: string;
let now: Date;
let sequence = 0;
const db = () => testDb.database.db;
const identity = (subject = `subject-${++sequence}`): VerifiedIdentity => ({
  issuer: "https://identity.example.invalid",
  subject,
  displayName: "Pessoa de teste",
  email: "contato@example.invalid",
});

beforeAll(async () => {
  testDb = await startTestDatabase();
  accounts = new AccountsService(testDb.database);
});
afterAll(async () => {
  await testDb?.stop();
});
beforeEach(async () => {
  now = new Date("2026-11-05T12:00:00Z");
  sessions = new AccountSessionsService(testDb.database, () => now);
  alice = await accounts.provisionIdentity(identity());
  bob = await accounts.provisionIdentity(identity());
  organizationId = (await accounts.listOrganizations(alice.id))[0]!.id;
  bobOrganizationId = (await accounts.listOrganizations(bob.id))[0]!.id;
});

describe("T25a — contas persistentes e organizações", () => {
  it("provisiona uma identidade uma única vez, com organização pessoal e papel owner", async () => {
    const verified = identity();
    const user = await accounts.provisionIdentity(verified);
    expect(
      await accounts.provisionIdentity({ ...verified, email: "novo@example.invalid" }),
    ).toEqual(user);
    expect(await accounts.listOrganizations(user.id)).toEqual([
      expect.objectContaining({ name: "Espaço de Pessoa de teste", role: "owner" }),
    ]);
    const anotherService = new AccountsService(testDb.database);
    expect(await anotherService.provisionIdentity(verified)).toEqual(user);
  });

  it("não une contas pelo email; issuer e subject formam a identidade", async () => {
    const verified = identity();
    const first = await accounts.provisionIdentity(verified);
    const otherIssuer = await accounts.provisionIdentity({
      ...verified,
      issuer: "https://another.example.invalid",
    });
    const otherSubject = await accounts.provisionIdentity({
      ...verified,
      subject: `other-${++sequence}`,
    });
    expect(new Set([alice.id, bob.id, first.id, otherIssuer.id, otherSubject.id]).size).toBe(5);
  });

  it("dois cadastros concorrentes produzem um usuário sem organização órfã", async () => {
    const verified = identity();
    const [before] = await db().select({ total: count() }).from(organizations);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => accounts.provisionIdentity(verified)),
    );
    expect(new Set(results.map((user) => user.id)).size).toBe(1);
    const [after] = await db().select({ total: count() }).from(organizations);
    expect(after!.total - before!.total).toBe(1);
    const stored = await db()
      .select()
      .from(identities)
      .where(and(eq(identities.issuer, verified.issuer), eq(identities.subject, verified.subject)));
    expect(stored).toHaveLength(1);
  });

  it("valida dados antes de persistir e desfaz uma organização sem usuário válido", async () => {
    await expect(accounts.provisionIdentity({ ...identity(), subject: "" })).rejects.toThrow();
    const [before] = await db().select({ total: count() }).from(organizations);
    await expect(
      accounts.createOrganization("00000000-0000-0000-0000-000000000000", "Inválida"),
    ).rejects.toThrow();
    const [after] = await db().select({ total: count() }).from(organizations);
    expect(after!.total).toBe(before!.total);
    await expect(accounts.createOrganization(alice.id, "  ")).rejects.toThrow();
  });

  it("lista apenas as organizações do usuário e recusa organização alheia ou inexistente", async () => {
    expect((await accounts.listOrganizations(alice.id)).map((item) => item.id)).toEqual([
      organizationId,
    ]);
    await expect(accounts.listMembers(alice.id, bobOrganizationId)).rejects.toThrow(
      OrganizationAccessError,
    );
    await expect(
      accounts.requireAccess(alice.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(OrganizationAccessError);
    await expect(accounts.requireAccess(bob.id, organizationId)).rejects.toThrow(
      OrganizationAccessError,
    );
    const team = await accounts.createOrganization(alice.id, "Equipe");
    expect(await accounts.requireAccess(alice.id, team.id)).toMatchObject({ role: "owner" });
  });

  it.each([
    ["viewer", "read", true],
    ["viewer", "write", false],
    ["member", "write", true],
    ["member", "manage_credentials", false],
    ["admin", "manage_credentials", true],
    ["admin", "manage_members", true],
  ] as const)("aplica papel %s à permissão %s", async (role, permission, allowed) => {
    await accounts.setMember(alice.id, organizationId, bob.id, role);
    const access = accounts.requireAccess(bob.id, organizationId, permission);
    if (allowed)
      await expect(access).resolves.toMatchObject({ role, userId: bob.id, organizationId });
    else await expect(access).rejects.toThrow(OrganizationAccessError);
  });

  it("admin gerencia membros, mas não altera proprietários nem promove a si mesmo", async () => {
    await accounts.setMember(alice.id, organizationId, bob.id, "admin");
    await expect(accounts.setMember(bob.id, organizationId, alice.id, "viewer")).rejects.toThrow(
      OrganizationAccessError,
    );
    await expect(accounts.setMember(bob.id, organizationId, bob.id, "owner")).rejects.toThrow(
      OrganizationAccessError,
    );
    const carol = await accounts.provisionIdentity(identity());
    await accounts.setMember(bob.id, organizationId, carol.id, "member");
    expect(await accounts.requireAccess(carol.id, organizationId, "write")).toMatchObject({
      role: "member",
    });
    await accounts.setMember(bob.id, organizationId, carol.id, null);
    await expect(accounts.requireAccess(carol.id, organizationId)).rejects.toThrow(
      OrganizationAccessError,
    );
  });

  it("recusa autoinscrição e alterações por membros sem privilégio", async () => {
    await expect(accounts.setMember(bob.id, organizationId, bob.id, "owner")).rejects.toThrow(
      OrganizationAccessError,
    );
    await accounts.setMember(alice.id, organizationId, bob.id, "member");
    await expect(accounts.setMember(bob.id, organizationId, bob.id, "admin")).rejects.toThrow(
      OrganizationAccessError,
    );
  });

  it("preserva o último proprietário, inclusive sob duas alterações concorrentes", async () => {
    await expect(accounts.setMember(alice.id, organizationId, alice.id, null)).rejects.toThrow(
      LastOwnerError,
    );
    await accounts.setMember(alice.id, organizationId, bob.id, "owner");
    const outcomes = await Promise.allSettled([
      accounts.setMember(alice.id, organizationId, alice.id, "member"),
      accounts.setMember(bob.id, organizationId, bob.id, "member"),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      (await accounts.listMembers(alice.id, organizationId)).filter(
        (member) => member.role === "owner",
      ),
    ).toHaveLength(1);
  });

  it("o banco recusa papéis inválidos e identidade vinculada a usuário inexistente", async () => {
    await expect(
      db()
        .update(memberships)
        .set({ role: "superuser" as never })
        .where(eq(memberships.organizationId, organizationId)),
    ).rejects.toThrow();
    await expect(
      db().insert(identities).values({
        issuer: "https://example.invalid",
        subject: "missing",
        userId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
  });
});

describe("T25a — sessões e renovação", () => {
  it("emite credenciais opacas distintas e persiste somente hashes", async () => {
    const session = await sessions.issue(alice.id, organizationId);
    expect(session.accessToken).toMatch(/^nsa_[A-Za-z0-9_-]{43}$/);
    expect(session.refreshToken).toMatch(/^nsr_[A-Za-z0-9_-]{43}$/);
    const [stored] = await db()
      .select()
      .from(accountSessions)
      .where(eq(accountSessions.id, session.sessionId));
    const [refresh] = await db()
      .select()
      .from(refreshCredentials)
      .where(eq(refreshCredentials.sessionId, session.sessionId));
    expect(stored!.accessTokenHash).toBe(
      createHash("sha256").update(session.accessToken).digest("hex"),
    );
    expect(refresh!.tokenHash).toBe(
      createHash("sha256").update(session.refreshToken).digest("hex"),
    );
    expect(JSON.stringify([stored, refresh])).not.toContain(session.accessToken);
    expect(JSON.stringify([stored, refresh])).not.toContain(session.refreshToken);
    expect(await sessions.authenticate(session.accessToken)).toEqual({
      sessionId: session.sessionId,
      userId: alice.id,
      organizationId,
      role: "owner",
    });
    expect(session.accessExpiresAt.getTime() - now.getTime()).toBe(15 * 60_000);
    expect(session.expiresAt.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60_000);
  });

  it("não emite sessão para uma organização alheia", async () => {
    await expect(sessions.issue(alice.id, bobOrganizationId)).rejects.toThrow(
      OrganizationAccessError,
    );
    const rows = await db()
      .select()
      .from(accountSessions)
      .where(eq(accountSessions.userId, alice.id));
    expect(rows).toHaveLength(0);
  });

  it("não aceita token de outro tipo, malformado ou desconhecido e não o inclui no erro", async () => {
    const session = await sessions.issue(alice.id, organizationId);
    for (const invalid of ["", "x".repeat(10_000), session.refreshToken, `nsa_${"x".repeat(43)}`]) {
      await expect(sessions.authenticate(invalid)).rejects.toThrow(InvalidSessionError);
    }
    await expect(sessions.refresh(session.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.refresh(`nsr_${"x".repeat(43)}`)).rejects.toThrow(
      "Sessão inválida ou expirada.",
    );
  });

  it("expira acesso aos 15 minutos, mas permite renovação até a expiração absoluta", async () => {
    const session = await sessions.issue(alice.id, organizationId);
    now = session.accessExpiresAt;
    await expect(sessions.authenticate(session.accessToken)).rejects.toThrow(InvalidSessionError);
    const renewed = await sessions.refresh(session.refreshToken);
    expect(renewed.expiresAt).toEqual(session.expiresAt);
    await expect(sessions.authenticate(renewed.accessToken)).resolves.toMatchObject({
      userId: alice.id,
    });
    now = session.expiresAt;
    await expect(sessions.authenticate(renewed.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.refresh(renewed.refreshToken)).rejects.toThrow(InvalidSessionError);
  });

  it("rotaciona ambos os tokens sem ampliar o prazo da sessão", async () => {
    const session = await sessions.issue(alice.id, organizationId);
    now = new Date(session.expiresAt.getTime() - 60_000);
    const renewed = await sessions.refresh(session.refreshToken);
    expect(renewed.accessToken).not.toBe(session.accessToken);
    expect(renewed.refreshToken).not.toBe(session.refreshToken);
    expect(renewed.sessionId).toBe(session.sessionId);
    expect(renewed.expiresAt).toEqual(session.expiresAt);
    expect(renewed.accessExpiresAt).toEqual(session.expiresAt);
    await expect(sessions.authenticate(session.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.authenticate(renewed.accessToken)).resolves.toMatchObject({
      userId: alice.id,
    });
  });

  it("reutilizar token consumido revoga a família inteira e mantém outras sessões", async () => {
    const original = await sessions.issue(alice.id, organizationId);
    const other = await sessions.issue(alice.id, organizationId);
    const renewed = await sessions.refresh(original.refreshToken);
    await expect(sessions.refresh(original.refreshToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.authenticate(renewed.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.refresh(renewed.refreshToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.authenticate(other.accessToken)).resolves.toMatchObject({
      userId: alice.id,
    });
    const [stored] = await db()
      .select()
      .from(accountSessions)
      .where(eq(accountSessions.id, original.sessionId));
    expect(stored!.revokedAt).toEqual(now);
  });

  it("duas renovações concorrentes não produzem duas credenciais válidas", async () => {
    const original = await sessions.issue(alice.id, organizationId);
    const outcomes = await Promise.allSettled([
      sessions.refresh(original.refreshToken),
      sessions.refresh(original.refreshToken),
    ]);
    const successful = outcomes.filter((result) => result.status === "fulfilled");
    expect(successful).toHaveLength(1);
    const renewed = successful[0]!.value;
    await expect(sessions.authenticate(renewed.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.refresh(renewed.refreshToken)).rejects.toThrow(InvalidSessionError);
  });

  it("logout é persistente, idempotente e específico à sessão", async () => {
    const original = await sessions.issue(alice.id, organizationId);
    const other = await sessions.issue(alice.id, organizationId);
    await sessions.revoke(original.refreshToken);
    await sessions.revoke(original.refreshToken);
    const restarted = new AccountSessionsService(testDb.database, () => now);
    await expect(restarted.authenticate(original.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(restarted.refresh(original.refreshToken)).rejects.toThrow(InvalidSessionError);
    await expect(restarted.authenticate(other.accessToken)).resolves.toMatchObject({
      userId: alice.id,
    });
  });

  it("alteração de papel vale imediatamente e remoção não é desfeita por nova inscrição", async () => {
    await accounts.setMember(alice.id, organizationId, bob.id, "member");
    const session = await sessions.issue(bob.id, organizationId);
    await accounts.setMember(alice.id, organizationId, bob.id, "viewer");
    expect(await sessions.authenticate(session.accessToken)).toMatchObject({ role: "viewer" });
    await accounts.setMember(alice.id, organizationId, bob.id, null);
    await accounts.setMember(alice.id, organizationId, bob.id, "member");
    await expect(sessions.authenticate(session.accessToken)).rejects.toThrow(InvalidSessionError);
    await expect(sessions.refresh(session.refreshToken)).rejects.toThrow(InvalidSessionError);
    expect(
      await db().select().from(accountSessions).where(eq(accountSessions.id, session.sessionId)),
    ).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(refreshCredentials)
        .where(eq(refreshCredentials.sessionId, session.sessionId)),
    ).toHaveLength(0);
  });

  it("reaplica migrações sem apagar as contas existentes", async () => {
    await expect(testDb.migrate()).resolves.toBeUndefined();
    const [user] = await db().select().from(users).where(eq(users.id, alice.id));
    expect(user!.id).toBe(alice.id);
  });
});
