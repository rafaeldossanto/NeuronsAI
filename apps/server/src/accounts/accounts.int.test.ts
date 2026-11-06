import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accountSessions,
  organizationInvitations,
  identities,
  memberships,
  organizations,
  refreshCredentials,
  users,
} from "../database/schema/accounts.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { AccountsService, type AccountUser } from "./accounts.service.js";
import { SignupPolicy } from "./signup-policy.js";
import {
  InvalidSessionError,
  InvitationNotFoundError,
  LastOwnerError,
  OrganizationAccessError,
  SignupClosedError,
} from "./account.errors.js";
import type { VerifiedIdentity } from "./identity-provider.js";
import { QuotaExceededError } from "../shared/errors/quota-exceeded.error.js";
import { testConfig } from "../shared/config/testing/test-config.js";

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
  accounts = new AccountsService(testDb.database, SignupPolicy.open());
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
    const anotherService = new AccountsService(testDb.database, SignupPolicy.open());
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

describe("cadastro fechado e convites", () => {
  const closed = () =>
    new AccountsService(
      testDb.database,
      new SignupPolicy({
        open: false,
        allowedDomains: ["liberado.example"],
        allowedEmails: ["dona@fora.example"],
      }),
    );
  const verified = (email: string, subject = `fechado-${++sequence}`): VerifiedIdentity => ({
    ...identity(subject),
    email,
  });
  const withoutEmail = (): VerifiedIdentity => {
    const value = identity(`sem-email-${++sequence}`);
    delete value.email;
    return value;
  };
  const countUsers = async () => (await db().select({ total: count() }).from(users))[0]!.total;

  it("recusa uma identidade desconhecida sem criar nada", async () => {
    const before = await countUsers();
    await expect(closed().provisionIdentity(withoutEmail())).rejects.toThrow(SignupClosedError);
    await expect(closed().provisionIdentity(verified("qualquer@outro.example"))).rejects.toThrow(
      SignupClosedError,
    );
    expect(await countUsers()).toBe(before);
  });

  it("admite o domínio e o e-mail da lista de permissão, com organização própria", async () => {
    const byDomain = await closed().provisionIdentity(verified("Gente@Liberado.example"));
    const byEmail = await closed().provisionIdentity(verified("dona@fora.example"));
    for (const user of [byDomain, byEmail]) {
      expect(await accounts.listOrganizations(user.id)).toEqual([
        expect.objectContaining({ role: "owner" }),
      ]);
    }
  });

  it("não admite subdomínio nem domínio parecido com o da lista", async () => {
    await expect(closed().provisionIdentity(verified("a@sub.liberado.example"))).rejects.toThrow(
      SignupClosedError,
    );
    await expect(closed().provisionIdentity(verified("a@xliberado.example"))).rejects.toThrow(
      SignupClosedError,
    );
  });

  it("admite quem foi convidado, só na organização que convidou e com o papel do convite", async () => {
    const invitation = await accounts.invite(
      alice.id,
      organizationId,
      "Nova.Pessoa@Fora.example",
      "member",
    );
    expect(invitation).toMatchObject({ email: "nova.pessoa@fora.example", role: "member" });
    const user = await closed().provisionIdentity(verified("NOVA.PESSOA@fora.example"));
    expect(
      (await accounts.listOrganizations(user.id)).map(({ id, role }) => ({ id, role })),
    ).toEqual([{ id: organizationId, role: "member" }]);
    expect(await accounts.listInvitations(alice.id, organizationId)).toEqual([]);
    // O convite é de uso único: outra identidade com o mesmo e-mail não entra.
    await expect(closed().provisionIdentity(verified("nova.pessoa@fora.example"))).rejects.toThrow(
      SignupClosedError,
    );
  });

  it("só vale com e-mail verificado: sem e-mail o convite não é resgatado", async () => {
    await accounts.invite(alice.id, organizationId, "sem.verificacao@fora.example", "viewer");
    await expect(closed().provisionIdentity(withoutEmail())).rejects.toThrow(SignupClosedError);
    expect(await accounts.listInvitations(alice.id, organizationId)).toHaveLength(1);
  });

  it("não resgata convite vencido", async () => {
    await accounts.invite(alice.id, organizationId, "vencido@fora.example", "member");
    await db()
      .update(organizationInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(closed().provisionIdentity(verified("vencido@fora.example"))).rejects.toThrow(
      SignupClosedError,
    );
    expect(await accounts.listInvitations(alice.id, organizationId)).toEqual([]);
  });

  it("resgata o convite de quem já tem conta, sem rebaixar o papel que já tem", async () => {
    const existing = await closed().provisionIdentity(verified("dona@fora.example", "ja-existe"));
    const ownOrganization = (await accounts.listOrganizations(existing.id))[0]!.id;
    await accounts.invite(alice.id, organizationId, "dona@fora.example", "viewer");
    await accounts.invite(existing.id, ownOrganization, "dona@fora.example", "viewer");
    await closed().provisionIdentity(verified("dona@fora.example", "ja-existe"));
    const roles = await accounts.listOrganizations(existing.id);
    expect(roles.find((entry) => entry.id === organizationId)?.role).toBe("viewer");
    expect(roles.find((entry) => entry.id === ownOrganization)?.role).toBe("owner");
  });

  it("um admin não convida nem cancela convites de admin/owner, só um owner", async () => {
    await accounts.setMember(alice.id, organizationId, bob.id, "admin");
    await expect(
      accounts.invite(bob.id, organizationId, "x@fora.example", "admin"),
    ).rejects.toThrow(OrganizationAccessError);
    await expect(
      accounts.invite(bob.id, organizationId, "x@fora.example", "owner"),
    ).rejects.toThrow(OrganizationAccessError);
    expect(await accounts.invite(bob.id, organizationId, "x@fora.example", "member")).toMatchObject(
      { role: "member" },
    );
    const privileged = await accounts.invite(alice.id, organizationId, "y@fora.example", "admin");
    await expect(accounts.revokeInvitation(bob.id, organizationId, privileged.id)).rejects.toThrow(
      OrganizationAccessError,
    );
    await accounts.revokeInvitation(alice.id, organizationId, privileged.id);
    await expect(
      accounts.revokeInvitation(alice.id, organizationId, privileged.id),
    ).rejects.toThrow(InvitationNotFoundError);
  });

  it("member não convida nem lista convites, e ninguém mexe nos convites de outra organização", async () => {
    await accounts.setMember(alice.id, organizationId, bob.id, "member");
    await expect(
      accounts.invite(bob.id, organizationId, "z@fora.example", "viewer"),
    ).rejects.toThrow(OrganizationAccessError);
    await expect(accounts.listInvitations(bob.id, organizationId)).rejects.toThrow(
      OrganizationAccessError,
    );
    await expect(accounts.listInvitations(alice.id, bobOrganizationId)).rejects.toThrow(
      OrganizationAccessError,
    );
    const own = await accounts.invite(bob.id, bobOrganizationId, "w@fora.example", "viewer");
    await expect(accounts.revokeInvitation(alice.id, organizationId, own.id)).rejects.toThrow(
      InvitationNotFoundError,
    );
  });

  it("convidar o mesmo e-mail de novo atualiza o papel em vez de duplicar", async () => {
    await accounts.invite(alice.id, organizationId, "repete@fora.example", "viewer");
    await accounts.invite(alice.id, organizationId, "REPETE@fora.example", "member");
    expect(await accounts.listInvitations(alice.id, organizationId)).toEqual([
      expect.objectContaining({ email: "repete@fora.example", role: "member" }),
    ]);
  });

  it("recusa e-mail inválido no convite", async () => {
    await expect(
      accounts.invite(alice.id, organizationId, "isso nao e email", "member"),
    ).rejects.toThrow();
  });
});

describe("cota de organizações por conta", () => {
  const limited = (organizationsPerUser: number) =>
    new AccountsService(
      testDb.database,
      SignupPolicy.open(),
      testConfig({
        quotas: {
          organizationsPerUser,
          memoriesPerOrganization: 0,
          memoryBytesPerOrganization: 0,
          concurrentRunsPerOrganization: 0,
          runsPerDayPerOrganization: 0,
        },
      }),
    );

  it("recusa a organização que passa do limite de proprietário (o espaço pessoal conta)", async () => {
    const service = limited(2);

    await service.createOrganization(alice.id, "Segunda");
    const refused = await service.createOrganization(alice.id, "Terceira").catch((e: unknown) => e);

    expect(refused).toBeInstanceOf(QuotaExceededError);
    expect(refused).toMatchObject({ code: "quota_organizations", kind: "quota_exceeded" });
    expect((await service.listOrganizations(alice.id)).map((o) => o.name)).not.toContain(
      "Terceira",
    );
  });

  it("só conta onde a conta é proprietária, e zero desliga o limite", async () => {
    await accounts.setMember(bob.id, bobOrganizationId, alice.id, "member");
    const service = limited(2);
    await service.createOrganization(alice.id, "Segunda");
    // Being a member elsewhere does not count against the limit; owning does.
    await expect(service.createOrganization(alice.id, "Terceira")).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    const unlimited = limited(0);
    await expect(unlimited.createOrganization(alice.id, "Terceira")).resolves.toBeDefined();
  });
});
