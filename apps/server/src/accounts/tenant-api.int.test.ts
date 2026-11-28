import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerScheduler } from "../triggers/trigger-scheduler.js";
import { WebSocket } from "ws";
import { FakeAgentRuntimeFactory } from "../agents/testing/fake-agent-runtime.js";
import { startTestApi } from "../api/testing/test-api.js";
import { rowsOf, startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { sql } from "drizzle-orm";
import { buildTestGraph } from "../hub/testing/test-graph.js";
import { eventually } from "../hub/testing/async-helpers.js";
import { GraphToolsService } from "../memories/graph-tools.service.js";
import { SecretsService } from "../secrets/secrets.service.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import { RunnerTokens } from "../runners/runner-tokens.service.js";
import { RunnerRegistry } from "../runners/runner-registry.js";
import { createMemoryChannelPair, PROTOCOL_VERSION } from "@neurons/runner-protocol";
import { HooksServer } from "../triggers/hooks-server.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { AccountAuth } from "./account-auth.service.js";
import { AccountsService } from "./accounts.service.js";
import { SignupPolicy } from "./signup-policy.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { BrowserSession } from "./browser-session.js";
import { OidcLoginService } from "./oidc-login.service.js";
import { SignupClosedError } from "./account.errors.js";
import { resourceScope } from "./resource-scope.js";
import type { SessionCredentials } from "./account-sessions.service.js";

const origin = "https://neurons.example.invalid";
let db: TestDatabase;
let app: NestFastifyApplication;
let directory: string;
let accounts: AccountsService;
let sessions: AccountSessionsService;
let browser: BrowserSession;
let auth: AccountAuth;
let alice: Actor, bob: Actor;
let sequence = 0;
const sockets: WebSocket[] = [];
interface Actor {
  credentials: SessionCredentials;
  headers: Record<string, string>;
  userId: string;
  organizationId: string;
}
const cookiesOf = (cookies: string[]) => cookies.map((cookie) => cookie.split(";")[0]).join("; ");
async function actor(subject: string): Promise<Actor> {
  const user = await accounts.provisionIdentity({
    issuer: "https://issuer.example.invalid",
    subject,
    displayName: subject,
  });
  const org = (await accounts.listOrganizations(user.id))[0]!;
  const credentials = await sessions.issue(user.id, org.id);
  return asActor(credentials, user.id, org.id);
}
function asActor(credentials: SessionCredentials, userId: string, organizationId: string): Actor {
  const cookies = browser.setCredentials(credentials);
  const csrf = cookies
    .find((cookie) => cookie.startsWith("__Host-neurons-csrf="))!
    .split(";")[0]!
    .split("=")[1]!;
  return {
    credentials,
    userId,
    organizationId,
    headers: { origin, cookie: cookiesOf(cookies), "x-neurons-csrf": csrf },
  };
}
async function api(
  who: Actor,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  return app.inject({ method, url, headers: who.headers, ...(payload && { payload }) });
}
/**
 * A project open to the whole organization, as every project was before per-project access: the
 * tests of roles and organizations are not about who a project is shared with. (The application
 * creates them restricted; see "acesso por projeto" below.)
 */
async function graph(who: Actor, name = "Projeto") {
  const created = await api(who, "POST", "/graphs", { name });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ id: string }>().id;
  const opened = await api(who, "PUT", `/graphs/${id}/access/mode`, { mode: "organization" });
  expect(opened.statusCode).toBe(200);
  return id;
}
async function publish(who: Actor, id: string, extra: object = {}) {
  const response = await api(who, "POST", `/graphs/${id}/versions`, {
    definition: { ...buildTestGraph(), id, ...extra },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}
async function run(who: Actor, version: string) {
  const response = await api(who, "POST", "/runs", { graphVersionId: version, input: "começar" });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

beforeAll(async () => {
  Logger.overrideLogger(false);
  db = await startTestDatabase();
  directory = path.resolve(await mkdtemp(path.join(os.tmpdir(), "neurons-tenants-")));
  accounts = new AccountsService(db.database, SignupPolicy.open());
  sessions = new AccountSessionsService(db.database);
  browser = new BrowserSession(sessions, origin);
});
beforeEach(async () => {
  const config = testConfig({
    profile: "hybrid",
    dataDir: directory,
    hooks: { port: 0, host: "127.0.0.1", maxBodyBytes: 1024, ratePerMinute: 100 },
    auth: {
      publicOrigin: origin,
      signup: { open: true, allowedDomains: [], allowedEmails: [] },
      google: {
        clientId: "test",
        clientSecret: "placeholder",
        redirectUri: `${origin}/auth/google/callback`,
      },
    },
  });
  const login = new OidcLoginService(
    db.database,
    accounts,
    sessions,
    {
      authorizationUrl: (input) =>
        new URL(`${origin}/provider?${new URLSearchParams(input).toString()}`),
      exchange: () =>
        Promise.resolve({
          issuer: "https://issuer.example.invalid",
          subject: `callback-${sequence}`,
          displayName: "Pessoa",
        }),
    },
    new AesGcmSecretCipher(randomBytes(32)),
    config.auth!.google.redirectUri,
  );
  auth = { config, browser, login, sessions, require: () => ({ browser, login }) };
  alice = await actor(`alice-${++sequence}`);
  bob = await actor(`bob-${sequence}`);
  app = await startTestApi(db, {
    config,
    auth,
    runtimes: new FakeAgentRuntimeFactory({ Alfa: () => new Promise<void>(() => undefined) }),
  });
});
afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) socket.terminate();
  await app?.close();
});
afterAll(async () => {
  await db?.stop();
  if (directory) {
    expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory)).toMatch(/^neurons-tenants-/);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});

describe("T25 — API entre organizações", () => {
  it("responde conta inexistente sem revelar dados a quem não gerencia membros", async () => {
    const url = `/auth/organizations/${alice.organizationId}/members/00000000-0000-4000-8000-000000000099`;
    const missing = await api(alice, "PUT", url, { role: "member" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "account_not_found" });
    expect((await api(bob, "PUT", url, { role: "member" })).statusCode).toBe(403);
    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "viewer");
    const viewer = asActor(
      await sessions.issue(bob.userId, alice.organizationId),
      bob.userId,
      alice.organizationId,
    );
    expect((await api(viewer, "PUT", url, { role: "member" })).statusCode).toBe(403);
  });
  it("retoma execuções de organizações diferentes sem perder o dono ao encerrar", async () => {
    const first = await run(alice, await publish(alice, await graph(alice)));
    const second = await run(bob, await publish(bob, await graph(bob)));
    await app.close();
    app = await startTestApi(db, {
      config: auth.config,
      auth,
      runtimes: new FakeAgentRuntimeFactory(),
    });
    await eventually(async () => {
      expect((await api(alice, "GET", `/runs/${first}`)).json<{ status: string }>().status).toBe(
        "succeeded",
      );
      expect((await api(bob, "GET", `/runs/${second}`)).json<{ status: string }>().status).toBe(
        "succeeded",
      );
    });
    expect((await api(bob, "GET", `/runs/${first}`)).statusCode).toBe(404);
  });

  it("recarrega e dispara cron de duas organizações depois de reiniciar o servidor", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      now: new Date("2026-11-05T12:00:30Z"),
    });
    const ids: { who: Actor; id: string }[] = [];
    for (const who of [alice, bob]) {
      const id = await graph(who),
        fixture = buildTestGraph();
      await publish(who, id, {
        nodes: fixture.nodes.map((node) =>
          node.type === "trigger"
            ? { ...node, kind: "schedule", cron: "* * * * *", timezone: "UTC" }
            : node,
        ),
      });
      expect(
        (await api(who, "PUT", `/graphs/${id}/triggers/gatilho/enabled`, { enabled: true }))
          .statusCode,
      ).toBe(200);
      ids.push({ who, id });
    }
    await app.close();
    app = await startTestApi(db, {
      config: auth.config,
      auth,
      runtimes: new FakeAgentRuntimeFactory({ Alfa: () => new Promise<void>(() => undefined) }),
    });
    expect(app.get(TriggerScheduler).armedCount).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();
    for (const { who, id } of ids) {
      await eventually(async () =>
        expect((await api(who, "GET", `/runs?graphId=${id}`)).json<{ total: number }>().total).toBe(
          1,
        ),
      );
      await api(who, "PUT", `/graphs/${id}/triggers/gatilho/enabled`, { enabled: false });
    }
  });
  it("seleciona apenas organização autorizada, rotaciona a sessão e aplica os papéis por REST", async () => {
    expect(
      (await api(alice, "POST", "/auth/organization", { organizationId: bob.organizationId }))
        .statusCode,
    ).toBe(403);
    expect((await api(alice, "GET", "/graphs")).statusCode).toBe(200);
    const added = await api(
      bob,
      "PUT",
      `/auth/organizations/${bob.organizationId}/members/${alice.userId}`,
      { role: "viewer" },
    );
    expect(added.statusCode).toBe(204);
    const switched = await api(alice, "POST", "/auth/organization", {
      organizationId: bob.organizationId,
    });
    expect(switched.statusCode).toBe(204);
    const cookies = switched.headers["set-cookie"] as string[];
    const cookie = cookiesOf(cookies);
    const state = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie } });
    expect(state.json()).toMatchObject({ organizationId: bob.organizationId, role: "viewer" });
    expect((await api(alice, "GET", "/graphs")).statusCode).toBe(403);
    const denied = await app.inject({
      method: "PUT",
      url: `/auth/organizations/${bob.organizationId}/members/${alice.userId}`,
      headers: { origin, cookie, "x-neurons-csrf": state.json<{ csrfToken: string }>().csrfToken },
      payload: { role: "owner" },
    });
    expect(denied.statusCode).toBe(403);
  });
  it("recusa acesso sem sessão e alterações sem origem/CSRF", async () => {
    for (const url of ["/graphs", "/runs", "/memories", "/secrets", "/runners"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/graphs",
          headers: { cookie: alice.headers.cookie },
          payload: { name: "recusado" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/graphs",
          headers: { ...alice.headers, origin: "https://other.invalid" },
          payload: { name: "recusado" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("isola grafos, versões e alterações, inclusive quando o outro id é conhecido", async () => {
    const first = await graph(alice, "Projeto Alice"),
      second = await graph(bob, "Projeto Bob");
    const version = await publish(alice, first);
    expect(
      (await api(bob, "GET", "/graphs"))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id),
    ).toEqual([second]);
    for (const url of [
      `/graphs/${first}`,
      `/graphs/${first}/versions`,
      `/graphs/${first}/versions/1`,
    ])
      expect((await api(bob, "GET", url)).statusCode).toBe(404);
    expect((await api(bob, "PATCH", `/graphs/${first}`, { name: "invadido" })).statusCode).toBe(
      404,
    );
    expect((await api(bob, "DELETE", `/graphs/${first}`)).statusCode).toBe(404);
    expect(
      (await api(bob, "POST", "/runs", { graphVersionId: version, input: "invadir" })).statusCode,
    ).toBe(404);
    expect((await api(alice, "GET", `/graphs/${first}`)).json<{ name: string }>().name).toBe(
      "Projeto Alice",
    );
  });

  it("isola histórico, eventos, mensagens, replay e parada de execuções", async () => {
    const first = await run(alice, await publish(alice, await graph(alice)));
    const second = await run(bob, await publish(bob, await graph(bob)));
    expect(
      (await api(alice, "GET", "/runs")).json<{ total: number; items: { id: string }[] }>(),
    ).toMatchObject({ total: 1, items: [{ id: first }] });
    for (const url of [`/runs/${first}`, `/runs/${first}/events`, `/runs/${first}/messages`])
      expect((await api(bob, "GET", url)).statusCode).toBe(404);
    expect((await api(bob, "POST", `/runs/${first}/stop`)).statusCode).toBe(404);
    expect(
      (await api(bob, "POST", `/runs/${first}/messages`, { to: "Alfa", body: "invadir" }))
        .statusCode,
    ).toBe(404);
    expect((await api(bob, "GET", `/runs/${second}`)).statusCode).toBe(200);
  });

  it("mantém segredos com o mesmo nome separados, sem leitura do namespace local", async () => {
    const secrets = app.get(SecretsService);
    await secrets.set("LOCAL_ONLY", "local");
    expect((await api(alice, "PUT", "/secrets/SHARED_NAME", { value: "alice" })).statusCode).toBe(
      204,
    );
    expect((await api(bob, "PUT", "/secrets/SHARED_NAME", { value: "bob" })).statusCode).toBe(204);
    expect((await api(alice, "GET", "/secrets")).json()).toEqual({ names: ["SHARED_NAME"] });
    expect(
      await resourceScope.run({ organizationId: alice.organizationId }, () =>
        secrets.get("SHARED_NAME"),
      ),
    ).toBe("alice");
    expect(
      await resourceScope.run({ organizationId: bob.organizationId }, () =>
        secrets.get("SHARED_NAME"),
      ),
    ).toBe("bob");
    await expect(
      resourceScope.run({ organizationId: alice.organizationId }, () => secrets.get("LOCAL_ONLY")),
    ).rejects.toThrow();
  });

  it("isola memórias e mantém a organização do run ao chamar ferramentas fora da requisição", async () => {
    const makeMemory = async (who: Actor) => {
      const response = await api(who, "POST", "/memories", {
        name: "Notas",
        storage: "server",
        files: [
          {
            path: "Nota.md",
            data: Buffer.from(who === alice ? "Alice" : "Bob").toString("base64"),
          },
        ],
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>().id;
    };
    const ownMemory = await makeMemory(alice),
      otherMemory = await makeMemory(bob);
    expect(
      (await api(alice, "GET", "/memories"))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id),
    ).toEqual([ownMemory]);
    expect(
      (
        await api(alice, "POST", "/memories", {
          name: "Cofre local",
          storage: "local",
          vaultPath: directory,
        })
      ).statusCode,
    ).toBe(400);
    const id = await graph(alice);
    const fixture = buildTestGraph();
    const definition = {
      nodes: [
        ...fixture.nodes,
        ...[ownMemory, otherMemory].map((memoryId, index) => ({
          id: `memory-${index}`,
          type: "tool",
          name: "Notas",
          position: { x: 0, y: 100 },
          tool: { kind: "obsidian", memoryId, readOnly: true },
        })),
      ],
      links: [
        ...fixture.links,
        ...[0, 1].map((index) => ({
          id: `uses-${index}`,
          from: "agente-alfa",
          to: `memory-${index}`,
          kind: "uses",
          bidirectional: false,
        })),
      ],
    };
    const runId = await run(alice, await publish(alice, id, definition));
    const tools = app.get(GraphToolsService);
    const result = await resourceScope.run({ organizationId: bob.organizationId }, () =>
      tools.use(runId, "Alfa", "memory-0", "obsidian_read", { path: "Nota.md" }, () =>
        Promise.resolve(),
      ),
    );
    expect(JSON.stringify(result)).toContain("Alice");
    expect(JSON.stringify(result)).not.toContain("Bob");
    await expect(
      tools.use(runId, "Alfa", "memory-1", "obsidian_read", { path: "Nota.md" }, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow("Memória não encontrada");
  });

  it("emite/revoga runners por organização, permite nomes iguais e não retorna tokens na lista", async () => {
    const first = await api(alice, "POST", "/runners", { name: "Meu computador" });
    const second = await api(bob, "POST", "/runners", { name: "Meu computador" });
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    const issued = first.json<{ id: string; token: string }>(),
      other = second.json<{ id: string; token: string }>();
    const list = await api(bob, "GET", "/runners");
    expect(list.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      other.id,
    ]);
    expect(list.body).not.toContain(other.token);
    expect(list.body).not.toContain(issued.id);
    const tokens = app.get(RunnerTokens);
    expect(await tokens.authenticate(issued.token)).toMatchObject({
      organizationId: alice.organizationId,
    });
    const pair = createMemoryChannelPair();
    app.get(RunnerRegistry).accept((await tokens.authenticate(issued.token))!, pair.server);
    pair.runner.send({
      v: PROTOCOL_VERSION,
      type: "register",
      runner: { name: "Meu computador", platform: "win32" },
      capabilities: { terminal: true, streamJson: true },
      agents: [],
    });
    expect((await api(alice, "GET", "/runners")).json()).toMatchObject({
      items: [{ id: issued.id, connected: true, activeAgents: 0, lastSeenAt: null }],
    });
    expect((await api(bob, "GET", "/runners")).json()).toMatchObject({
      items: [{ id: other.id, connected: false, activeAgents: 0 }],
    });
    pair.runner.close(1000, "test disconnect");
    expect((await api(alice, "GET", "/runners")).json()).toMatchObject({
      items: [{ connected: false }],
    });
    await api(alice, "DELETE", "/runners/Meu%20computador");
    expect(await tokens.authenticate(issued.token)).toBeUndefined();
    const revokedList = (await api(alice, "GET", "/runners")).json<{
      items: { connected: boolean; activeAgents: number; revokedAt: string | null }[];
    }>();
    expect(revokedList).toMatchObject({ items: [{ connected: false, activeAgents: 0 }] });
    expect(revokedList.items[0]!.revokedAt).toEqual(expect.any(String));
    expect(await tokens.authenticate(other.token)).toMatchObject({
      organizationId: bob.organizationId,
    });
  });

  it("runners pessoais: só o dono emite, lista e revoga; trocar o token mantém o registro; sair da organização revoga", async () => {
    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "member");
    const member = asActor(
      await sessions.issue(bob.userId, alice.organizationId),
      bob.userId,
      alice.organizationId,
    );
    const mine = await api(alice, "POST", "/runners/personal", { name: "  Notebook  " });
    expect(mine.statusCode).toBe(201);
    const issued = mine.json<{ id: string; name: string; token: string }>();
    expect(issued.name).toBe("Notebook");
    expect(issued.token).toMatch(/^nrn_/);
    const tokens = app.get(RunnerTokens);
    expect(await tokens.authenticate(issued.token)).toMatchObject({
      id: issued.id,
      organizationId: alice.organizationId,
      ownerUserId: alice.userId,
    });

    // Each one sees only their own computers; the organization's list leaves personal ones out.
    const listed = await api(alice, "GET", "/runners/personal");
    expect(listed.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([
      issued.id,
    ]);
    expect(listed.body).not.toContain(issued.token);
    expect((await api(member, "GET", "/runners/personal")).json()).toEqual({ items: [] });
    expect((await api(alice, "GET", "/runners")).json()).toEqual({ items: [] });

    // Another member cannot revoke it: for them it does not exist.
    expect((await api(member, "DELETE", `/runners/personal/${issued.id}`)).statusCode).toBe(404);
    expect(await tokens.isActive(issued.id)).toBe(true);
    // Nor does a manager of the organization's runners see it by name.
    expect((await api(alice, "DELETE", "/runners/Notebook")).statusCode).toBe(204);
    expect(await tokens.isActive(issued.id)).toBe(true);

    expect((await api(alice, "DELETE", `/runners/personal/${issued.id}`)).statusCode).toBe(204);
    expect(await tokens.authenticate(issued.token)).toBeUndefined();

    // The same name again: same runner, new token, active.
    const again = (await api(alice, "POST", "/runners/personal", { name: "Notebook" })).json<{
      id: string;
      token: string;
    }>();
    expect(again.id).toBe(issued.id);
    expect(again.token).not.toBe(issued.token);
    expect(await tokens.authenticate(issued.token)).toBeUndefined();
    expect(await tokens.authenticate(again.token)).toMatchObject({ id: issued.id });

    // A viewer cannot create one; a member can.
    const memberRunner = await api(member, "POST", "/runners/personal", { name: "Notebook" });
    expect(memberRunner.statusCode).toBe(201);
    const memberId = memberRunner.json<{ id: string }>().id;
    expect(memberId).not.toBe(issued.id);
    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "viewer");
    const viewer = asActor(
      await sessions.issue(bob.userId, alice.organizationId),
      bob.userId,
      alice.organizationId,
    );
    expect((await api(viewer, "POST", "/runners/personal", { name: "Outro" })).statusCode).toBe(
      403,
    );

    // Leaving the organization revokes the member's computers there.
    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, null);
    expect(await tokens.isActive(memberId)).toBe(false);
    expect(await tokens.isActive(issued.id)).toBe(true);
  });

  it("grava quem iniciou a execução pela API", async () => {
    const version = await publish(alice, await graph(alice));
    const id = await run(alice, version);

    const rows = rowsOf<{ started_by_user_id: string | null }>(
      await db.database.db.execute(sql`select started_by_user_id from runs where id = ${id}`),
    );
    expect(rows[0]?.started_by_user_id).toBe(alice.userId);
  });

  it("aplica viewer imediatamente aos writes de recursos e credenciais", async () => {
    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "viewer");
    const viewer = asActor(
      await sessions.issue(bob.userId, alice.organizationId),
      bob.userId,
      alice.organizationId,
    );
    expect((await api(viewer, "GET", "/graphs")).statusCode).toBe(200);
    expect((await api(viewer, "POST", "/graphs", { name: "não permitido" })).statusCode).toBe(403);
    expect((await api(viewer, "POST", "/runners", { name: "não permitido" })).statusCode).toBe(403);
    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, null);
    expect((await api(viewer, "GET", "/graphs")).statusCode).toBe(403);
  });

  it("callback usa cookie vinculado e retorna apenas cookies HttpOnly, sem tokens no corpo", async () => {
    const begin = await app.inject({ method: "POST", url: "/auth/google", headers: { origin } });
    expect(begin.statusCode).toBe(200);
    const state = new URL(
      begin.json<{ authorizationUrl: string }>().authorizationUrl,
    ).searchParams.get("state")!;
    const loginCookie = String(begin.headers["set-cookie"]).split(";")[0]!;
    const callbackUrl = `/auth/google/callback?state=${state}&code=test`;
    expect((await app.inject({ method: "GET", url: callbackUrl })).statusCode).toBe(403);
    const complete = await app.inject({
      method: "GET",
      url: callbackUrl,
      headers: { cookie: loginCookie },
    });
    expect(complete.statusCode).toBe(302);
    expect(complete.headers.location).toBe("/graphs");
    expect(complete.body).not.toContain("nsa_");
    expect(complete.body).not.toContain("nsr_");
    expect(
      (await app.inject({ method: "GET", url: callbackUrl, headers: { cookie: loginCookie } }))
        .statusCode,
    ).toBe(403);
  });

  it("webhook resolve a organização do grafo antes de obter segredo e iniciar a execução", async () => {
    const id = await graph(alice),
      fixture = buildTestGraph();
    await publish(alice, id, {
      nodes: fixture.nodes.map((node) =>
        node.type === "trigger" ? { ...node, kind: "webhook" } : node,
      ),
    });
    const secretReply = await api(alice, "POST", `/graphs/${id}/triggers/gatilho/secret`);
    expect(secretReply.statusCode).toBe(201);
    const data = secretReply.json<{ secret: string; state: { hookPath: string } }>();
    await api(alice, "PUT", `/graphs/${id}/triggers/gatilho/enabled`, { enabled: true });
    const timestamp = String(Math.floor(Date.now() / 1000)),
      body = "evento";
    const signature = createHmac("sha256", data.secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(
      `http://127.0.0.1:${app.get(HooksServer).port}${data.state.hookPath}`,
      {
        method: "POST",
        body,
        headers: {
          "content-type": "text/plain",
          "x-neurons-timestamp": timestamp,
          "x-neurons-signature": `sha256=${signature}`,
        },
      },
    );
    expect(response.status).toBe(202);
    const started = (await response.json()) as { runId: string };
    expect((await api(alice, "GET", `/runs/${started.runId}`)).statusCode).toBe(200);
    expect((await api(bob, "GET", `/runs/${started.runId}`)).statusCode).toBe(404);
  });

  it("WebSocket recusa run alheio, valida origem e corta dados após revogação", async () => {
    const runId = await run(alice, await publish(alice, await graph(alice)));
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const connect = async (who: Actor) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: who.headers });
      sockets.push(socket);
      const frames: { event: string; data: unknown }[] = [];
      socket.on("message", (value) =>
        frames.push(JSON.parse((value as Buffer).toString()) as { event: string; data: unknown }),
      );
      await new Promise<void>((resolve) => socket.once("open", resolve));
      return { socket, frames };
    };
    const foreign = await connect(bob);
    foreign.socket.send(JSON.stringify({ event: "subscribe", data: { runId, fromSeq: 1 } }));
    await eventually(() =>
      expect(foreign.frames.some((frame) => frame.event === "error")).toBe(true),
    );
    expect(foreign.frames.some((frame) => frame.event === "run.event")).toBe(false);
    const own = await connect(alice);
    own.socket.send(JSON.stringify({ event: "subscribe", data: { runId, fromSeq: 1 } }));
    await eventually(() =>
      expect(own.frames.some((frame) => frame.event === "run.event")).toBe(true),
    );
    await sessions.revoke(alice.credentials.refreshToken);
    // Trigger delivery through the live publisher after revocation; it must close before sending.
    const { RunSubscriptions } = await import("../realtime/run-subscriptions.js");
    const before = own.frames.length;
    app.get(RunSubscriptions).publish({
      runId,
      seq: 999,
      type: "PrivateAfterRevoke",
      agent: null,
      payload: {},
      at: new Date(),
    });
    await eventually(() => expect(own.socket.readyState).toBe(WebSocket.CLOSED));
    expect(
      own.frames
        .slice(before)
        .some((frame) => JSON.stringify(frame).includes("PrivateAfterRevoke")),
    ).toBe(false);
  });
  it("WebSocket: unsubscribe antes de subscribe não desliga a revalidação; origem errada e terminal.input alheio são recusados", async () => {
    const runId = await run(alice, await publish(alice, await graph(alice)));
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const connect = async (headers: Record<string, string>) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      sockets.push(socket);
      const frames: { event: string; data: unknown }[] = [];
      socket.on("message", (value) =>
        frames.push(JSON.parse((value as Buffer).toString()) as { event: string; data: unknown }),
      );
      await new Promise<void>((resolve) => socket.once("open", resolve));
      return { socket, frames };
    };
    const subscribe = { event: "subscribe", data: { runId, fromSeq: 1 } };
    const wrongOrigin = await connect({ ...alice.headers, origin: "https://evil.example.invalid" });
    wrongOrigin.socket.send(JSON.stringify(subscribe));
    await eventually(() =>
      expect(wrongOrigin.frames.some((frame) => frame.event === "error")).toBe(true),
    );
    expect(wrongOrigin.frames.some((frame) => frame.event === "run.event")).toBe(false);

    const foreign = await connect(bob.headers);
    foreign.socket.send(
      JSON.stringify({ event: "terminal.input", data: { runId, agent: "a", data: "x" } }),
    );
    await eventually(() =>
      expect(foreign.frames.some((frame) => frame.event === "error")).toBe(true),
    );
    expect(foreign.frames.some((frame) => frame.event === "run.event")).toBe(false);

    const own = await connect(alice.headers);
    own.socket.send(JSON.stringify({ event: "unsubscribe", data: { runId } }));
    own.socket.send(JSON.stringify(subscribe));
    await eventually(() =>
      expect(own.frames.some((frame) => frame.event === "run.event")).toBe(true),
    );
    await sessions.revoke(alice.credentials.refreshToken);
    const { RunSubscriptions } = await import("../realtime/run-subscriptions.js");
    const before = own.frames.length;
    app.get(RunSubscriptions).publish({
      runId,
      seq: 999,
      type: "PrivateAfterRevoke",
      agent: null,
      payload: {},
      at: new Date(),
    });
    await eventually(() => expect(own.socket.readyState).toBe(WebSocket.CLOSED));
    expect(
      own.frames
        .slice(before)
        .some((frame) => JSON.stringify(frame).includes("PrivateAfterRevoke")),
    ).toBe(false);
  });

  it("manda a conta sem convite de volta para a interface com o aviso de acesso só por convite", async () => {
    const begin = await app.inject({ method: "POST", url: "/auth/google", headers: { origin } });
    const state = new URL(
      begin.json<{ authorizationUrl: string }>().authorizationUrl,
    ).searchParams.get("state")!;
    const loginCookie = String(begin.headers["set-cookie"]).split(";")[0]!;
    vi.spyOn(auth.login!, "complete").mockRejectedValueOnce(new SignupClosedError());
    const complete = await app.inject({
      method: "GET",
      url: `/auth/google/callback?state=${state}&code=test`,
      headers: { cookie: loginCookie },
    });
    expect(complete.statusCode).toBe(302);
    expect(complete.headers.location).toBe("/graphs?login_error=signup_closed");
    expect(String(complete.headers["set-cookie"])).not.toMatch(/nsa_|nsr_/);
  });

  it("convites: owner/admin convidam por e-mail; member e viewer não; o convite fica só na organização", async () => {
    const url = `/auth/organizations/${alice.organizationId}/invitations`;
    const created = await api(alice, "POST", url, {
      email: "Convidada@Fora.example",
      role: "member",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: "convidada@fora.example", role: "member" });
    const listed = await api(alice, "GET", url);
    expect(listed.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(
      (await api(alice, "POST", url, { email: "nao-e-email", role: "member" })).statusCode,
    ).toBe(400);

    // Outra organização não vê nem cria convites aqui.
    expect((await api(bob, "GET", url)).statusCode).toBe(403);
    expect(
      (await api(bob, "POST", url, { email: "x@fora.example", role: "viewer" })).statusCode,
    ).toBe(403);

    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "member");
    const member = asActor(
      await sessions.issue(bob.userId, alice.organizationId),
      bob.userId,
      alice.organizationId,
    );
    expect((await api(member, "GET", url)).statusCode).toBe(403);
    expect(
      (await api(member, "POST", url, { email: "y@fora.example", role: "viewer" })).statusCode,
    ).toBe(403);

    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "admin");
    expect(
      (await api(member, "POST", url, { email: "y@fora.example", role: "viewer" })).statusCode,
    ).toBe(201);
    expect(
      (await api(member, "POST", url, { email: "z@fora.example", role: "admin" })).statusCode,
    ).toBe(403);

    const id = created.json<{ id: string }>().id;
    expect((await api(alice, "DELETE", `${url}/${id}`)).statusCode).toBe(204);
    expect((await api(alice, "DELETE", `${url}/${id}`)).statusCode).toBe(404);
  });

  it("só admin ou owner publicam uma versão que usa {{secret:...}}", async () => {
    const id = await graph(alice);
    const base = buildTestGraph();
    const withSecret = {
      ...base,
      id,
      nodes: [
        ...base.nodes,
        {
          id: "ferramenta-externa",
          type: "tool",
          position: { x: 0, y: 0 },
          name: "Externa",
          tool: {
            kind: "http",
            method: "GET",
            url: "https://api.exemplo.com.br/dados",
            headers: { Authorization: "Bearer {{secret:CHAVE}}" },
          },
        },
      ],
      links: [
        ...base.links,
        {
          id: "uso",
          from: "agente-alfa",
          to: "ferramenta-externa",
          kind: "uses",
          bidirectional: false,
        },
      ],
    };
    const publishWith = (who: Actor) =>
      api(who, "POST", `/graphs/${id}/versions`, { definition: withSecret });

    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "member");
    const member = asActor(
      await sessions.issue(bob.userId, alice.organizationId),
      bob.userId,
      alice.organizationId,
    );
    const denied = await publishWith(member);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "secret_publish_forbidden" });
    // Sem segredo, o mesmo member publica normalmente.
    expect(
      (await api(member, "POST", `/graphs/${id}/versions`, { definition: { ...base, id } }))
        .statusCode,
    ).toBe(201);

    await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "admin");
    expect((await publishWith(member)).statusCode).toBe(201);
    expect((await publishWith(alice)).statusCode).toBe(201);
  });
});

it("requires credential management to rotate a webhook secret, independently of the graphs controller prefix", async () => {
  await accounts.setMember(alice.userId, alice.organizationId, bob.userId, "member");
  const member = asActor(
    await sessions.issue(bob.userId, alice.organizationId),
    bob.userId,
    alice.organizationId,
  );
  const url = "/graphs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/triggers/webhook/secret";
  expect((await api(member, "POST", url)).statusCode).toBe(403);
  expect((await api(alice, "POST", url)).statusCode).toBe(404);
});

describe("exclusão de projeto: só proprietário e administrador, os demais pedem", () => {
  const asRole = async (who: Actor, role: "member" | "viewer" | "admin") => {
    await accounts.setMember(alice.userId, alice.organizationId, who.userId, role);
    return asActor(
      await sessions.issue(who.userId, alice.organizationId),
      who.userId,
      alice.organizationId,
    );
  };
  const pendingOf = async (who: Actor, id: string) =>
    (await api(who, "GET", "/graphs"))
      .json<{ items: { id: string; deletionRequest: { requestedBy: { id: string } } | null }[] }>()
      .items.find((item) => item.id === id)?.deletionRequest;

  it("membro e leitor recebem 403 ao excluir direto, e o projeto fica; o proprietário exclui", async () => {
    const id = await graph(alice);
    await publish(alice, id);
    const member = await asRole(bob, "member");
    expect((await api(member, "DELETE", `/graphs/${id}`)).statusCode).toBe(403);
    const viewer = await asRole(bob, "viewer");
    expect((await api(viewer, "DELETE", `/graphs/${id}`)).statusCode).toBe(403);
    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(200);

    expect((await api(alice, "DELETE", `/graphs/${id}`)).statusCode).toBe(204);
    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(404);
  });

  it("membro pede, o pedido aparece na lista com quem pediu e um segundo pedido é recusado", async () => {
    const id = await graph(alice);
    const member = await asRole(bob, "member");

    const created = await api(member, "POST", `/graphs/${id}/deletion-request`);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ requestedBy: { id: bob.userId } });
    expect(await pendingOf(alice, id)).toMatchObject({ requestedBy: { id: bob.userId } });

    const again = await api(member, "POST", `/graphs/${id}/deletion-request`);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "deletion_request_pending" });
  });

  it("proprietário não pede (exclui direto) e leitor não pede", async () => {
    const id = await graph(alice);
    const owner = await api(alice, "POST", `/graphs/${id}/deletion-request`);
    expect(owner.statusCode).toBe(409);
    expect(owner.json()).toMatchObject({ code: "deletion_request_not_needed" });
    const viewer = await asRole(bob, "viewer");
    expect((await api(viewer, "POST", `/graphs/${id}/deletion-request`)).statusCode).toBe(403);
  });

  it("só quem pediu cancela; depois de cancelar não há pedido", async () => {
    const id = await graph(alice);
    const member = await asRole(bob, "member");
    await api(member, "POST", `/graphs/${id}/deletion-request`);
    const url = `/graphs/${id}/deletion-request`;

    const notYours = await api(alice, "DELETE", url);
    expect(notYours.statusCode).toBe(403);
    expect(notYours.json()).toMatchObject({ code: "deletion_request_not_yours" });
    expect(await pendingOf(alice, id)).toBeTruthy();

    expect((await api(member, "DELETE", url)).statusCode).toBe(204);
    expect(await pendingOf(alice, id)).toBeNull();
    expect((await api(member, "DELETE", url)).statusCode).toBe(404);
  });

  it("recusar mantém o projeto; membro não recusa nem aprova", async () => {
    const id = await graph(alice);
    await publish(alice, id);
    const member = await asRole(bob, "member");
    await api(member, "POST", `/graphs/${id}/deletion-request`);

    expect((await api(member, "POST", `/graphs/${id}/deletion-request/reject`)).statusCode).toBe(
      403,
    );
    expect((await api(member, "POST", `/graphs/${id}/deletion-request/approve`)).statusCode).toBe(
      403,
    );
    expect((await api(alice, "POST", `/graphs/${id}/deletion-request/reject`)).statusCode).toBe(
      204,
    );
    expect(await pendingOf(alice, id)).toBeNull();
    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(200);
    expect((await api(alice, "POST", `/graphs/${id}/deletion-request/reject`)).statusCode).toBe(
      404,
    );
  });

  it("aprovar exclui o projeto publicado como o DELETE; administrador também aprova", async () => {
    const id = await graph(alice);
    await publish(alice, id);
    const member = await asRole(bob, "member");
    await api(member, "POST", `/graphs/${id}/deletion-request`);
    const carol = await actor(`carol-${++sequence}`);
    const admin = await (async () => {
      await accounts.setMember(alice.userId, alice.organizationId, carol.userId, "admin");
      return asActor(
        await sessions.issue(carol.userId, alice.organizationId),
        carol.userId,
        alice.organizationId,
      );
    })();

    expect((await api(admin, "POST", `/graphs/${id}/deletion-request/approve`)).statusCode).toBe(
      204,
    );

    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(404);
    expect((await api(alice, "GET", `/graphs/${id}/versions`)).statusCode).toBe(404);
  });

  it("aprovar com execução em andamento dá 409 e o pedido continua pendente", async () => {
    const id = await graph(alice);
    const version = await publish(alice, id);
    const runId = await run(alice, version);
    const member = await asRole(bob, "member");
    await api(member, "POST", `/graphs/${id}/deletion-request`);

    const refused = await api(alice, "POST", `/graphs/${id}/deletion-request/approve`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "graph_has_active_runs" });
    expect(await pendingOf(alice, id)).toBeTruthy();
    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(200);

    expect((await api(alice, "POST", `/runs/${runId}/stop`)).statusCode).toBe(200);
    expect((await api(alice, "POST", `/graphs/${id}/deletion-request/approve`)).statusCode).toBe(
      204,
    );
    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(404);
  });

  it("nada vale para o grafo de outra organização, mesmo sabendo o id", async () => {
    const id = await graph(alice);
    const member = await asRole(bob, "member");
    await api(member, "POST", `/graphs/${id}/deletion-request`);
    // Bob é proprietário da própria organização; Carol é membro dela.
    const carol = await actor(`carol-${++sequence}`);
    await accounts.setMember(bob.userId, bob.organizationId, carol.userId, "member");
    const foreignMember = asActor(
      await sessions.issue(carol.userId, bob.organizationId),
      carol.userId,
      bob.organizationId,
    );

    expect((await api(bob, "POST", `/graphs/${id}/deletion-request/approve`)).statusCode).toBe(404);
    expect((await api(bob, "POST", `/graphs/${id}/deletion-request/reject`)).statusCode).toBe(404);
    expect((await api(bob, "DELETE", `/graphs/${id}/deletion-request`)).statusCode).toBe(404);
    expect((await api(foreignMember, "POST", `/graphs/${id}/deletion-request`)).statusCode).toBe(
      404,
    );
    expect((await api(bob, "GET", "/graphs")).json<{ items: unknown[] }>().items).toEqual([]);
    expect(await pendingOf(alice, id)).toBeTruthy();
    expect((await api(alice, "GET", `/graphs/${id}`)).statusCode).toBe(200);
  });
});

describe("acesso por projeto", () => {
  interface ListedGraph {
    id: string;
    name: string;
    accessMode: string;
    owner: { id: string; name: string } | null;
    access: { level: string; request: string | null; pendingRequests: number };
  }
  interface AccessDetails {
    mode: string;
    owner: { id: string } | null;
    entries: {
      user: { id: string };
      status: string;
      level: string | null;
    }[];
  }

  /** A new person in alice's organization (she is its owner). */
  const member = async (name: string, role: "member" | "viewer" | "admin" = "member") => {
    const person = await actor(`${name}-${sequence}`);
    await accounts.setMember(alice.userId, alice.organizationId, person.userId, role);
    return asActor(
      await sessions.issue(person.userId, alice.organizationId),
      person.userId,
      alice.organizationId,
    );
  };
  /** The way the application creates them: restricted, owned by who created it. */
  async function restricted(who: Actor, draft: unknown = { nodes: ["rascunho"] }) {
    const created = await api(who, "POST", "/graphs", { name: "Projeto restrito", draft });
    expect(created.statusCode).toBe(201);
    return created.json<{ id: string }>().id;
  }
  const grant = (who: Actor, id: string, target: Actor, level: "use" | "edit") =>
    api(who, "PUT", `/graphs/${id}/access/${target.userId}`, { status: "granted", level });
  const listed = async (who: Actor, id: string) =>
    (await api(who, "GET", "/graphs"))
      .json<{ items: ListedGraph[] }>()
      .items.find((item) => item.id === id)!;
  const runIdsOf = async (who: Actor) =>
    (await api(who, "GET", "/runs")).json<{ items: { id: string }[] }>().items.map((r) => r.id);

  it("o projeto novo nasce restrito, com o dono, e quem não tem acesso o vê só com nome e metadados", async () => {
    const dona = await member("dona");
    const outsider = await member("fora");
    const id = await restricted(dona);

    expect(await listed(dona, id)).toMatchObject({
      accessMode: "restricted",
      owner: { id: dona.userId },
      access: { level: "manage" },
    });
    const seen = await listed(outsider, id);
    expect(seen).toMatchObject({
      name: "Projeto restrito",
      accessMode: "restricted",
      owner: { id: dona.userId },
      access: { level: "none", request: null, pendingRequests: 0 },
    });
    expect(seen).not.toHaveProperty("draft");

    await publish(dona, id);
    const probes: [Parameters<typeof api>[1], string, object?][] = [
      ["GET", `/graphs/${id}`],
      ["PATCH", `/graphs/${id}`, { name: "x" }],
      ["GET", `/graphs/${id}/versions`],
      ["GET", `/graphs/${id}/versions/1`],
      ["POST", `/graphs/${id}/versions`, {}],
      ["GET", `/graphs/${id}/access`],
      ["PUT", `/graphs/${id}/access/mode`, { mode: "organization" }],
      ["GET", `/graphs/${id}/triggers/gatilho`],
      ["PUT", `/graphs/${id}/triggers/gatilho/enabled`, { enabled: true }],
      ["POST", `/graphs/${id}/deletion-request`],
    ];
    for (const [method, url, body] of probes) {
      const reply = await api(outsider, method, url, body);
      expect([method, url, reply.statusCode]).toEqual([method, url, 404]);
    }
    expect((await api(dona, "GET", `/graphs/${id}`)).statusCode).toBe(200);
  });

  it("owners e administradores da organização acessam tudo, e o dono edita e gerencia", async () => {
    const dona = await member("dona");
    const admin = await member("adm", "admin");
    const id = await restricted(dona);
    await publish(dona, id);

    expect(await listed(alice, id)).toMatchObject({ access: { level: "manage" } });
    expect(await listed(admin, id)).toMatchObject({ access: { level: "manage" } });
    for (const who of [alice, admin, dona]) {
      expect((await api(who, "GET", `/graphs/${id}`)).statusCode).toBe(200);
      expect((await api(who, "PATCH", `/graphs/${id}`, { name: "Renomeado" })).statusCode).toBe(
        200,
      );
      expect((await api(who, "GET", `/graphs/${id}/access`)).statusCode).toBe(200);
    }
    expect((await api(alice, "GET", `/graphs/${id}/access`)).json<AccessDetails>()).toMatchObject({
      mode: "restricted",
      owner: { id: dona.userId },
    });
  });

  it("'pode usar' abre a versão publicada sem rascunho, roda e vê só as próprias execuções (REST e WebSocket)", async () => {
    const dona = await member("dona");
    const ana = await member("ana");
    const beto = await member("beto");
    const id = await restricted(dona);
    const version = await publish(dona, id);
    expect((await grant(dona, id, ana, "use")).statusCode).toBe(200);
    expect((await grant(dona, id, beto, "use")).statusCode).toBe(200);

    const opened = await api(ana, "GET", `/graphs/${id}`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({
      draft: null,
      latestVersion: 1,
      access: { level: "use" },
    });
    expect((await api(ana, "GET", `/graphs/${id}/versions`)).statusCode).toBe(200);
    expect((await api(ana, "GET", `/graphs/${id}/versions/1`)).statusCode).toBe(200);
    // Nothing that changes the project, its triggers or its access.
    expect((await api(ana, "PATCH", `/graphs/${id}`, { name: "x" })).statusCode).toBe(404);
    expect((await api(ana, "POST", `/graphs/${id}/versions`, {})).statusCode).toBe(404);
    expect((await api(ana, "GET", `/graphs/${id}/triggers/gatilho`)).statusCode).toBe(404);
    expect(
      (await api(ana, "PUT", `/graphs/${id}/triggers/gatilho/enabled`, { enabled: true }))
        .statusCode,
    ).toBe(404);
    expect((await api(ana, "GET", `/graphs/${id}/access`)).statusCode).toBe(404);

    const anaRun = await run(ana, version);
    const betoRun = await run(beto, version);
    expect(await runIdsOf(ana)).toEqual([anaRun]);
    expect(await runIdsOf(beto)).toEqual([betoRun]);
    expect((await runIdsOf(dona)).sort()).toEqual([anaRun, betoRun].sort());
    expect((await api(ana, "GET", `/runs?graphId=${id}`)).json<{ total: number }>().total).toBe(1);

    for (const [method, url] of [
      ["GET", `/runs/${betoRun}`],
      ["GET", `/runs/${betoRun}/events`],
      ["GET", `/runs/${betoRun}/messages`],
      ["POST", `/runs/${betoRun}/stop`],
    ] as const) {
      expect([url, (await api(ana, method, url)).statusCode]).toEqual([url, 404]);
    }
    expect(
      (await api(ana, "POST", `/runs/${betoRun}/messages`, { to: "Alfa", body: "oi" })).statusCode,
    ).toBe(404);
    expect((await api(ana, "GET", `/runs/${anaRun}`)).statusCode).toBe(200);
    expect((await api(ana, "GET", `/runs/${anaRun}/events`)).statusCode).toBe(200);
    expect((await api(dona, "GET", `/runs/${betoRun}`)).statusCode).toBe(200);

    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const connect = async (who: Actor) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: who.headers });
      sockets.push(socket);
      const frames: { event: string; data: unknown }[] = [];
      socket.on("message", (value) =>
        frames.push(JSON.parse((value as Buffer).toString()) as { event: string; data: unknown }),
      );
      await new Promise<void>((resolve) => socket.once("open", resolve));
      return { socket, frames };
    };
    const colleague = await connect(ana);
    colleague.socket.send(
      JSON.stringify({ event: "subscribe", data: { runId: betoRun, fromSeq: 1 } }),
    );
    await eventually(() =>
      expect(colleague.frames.some((frame) => frame.event === "error")).toBe(true),
    );
    expect(colleague.frames.some((frame) => frame.event === "run.event")).toBe(false);
    colleague.socket.send(
      JSON.stringify({ event: "subscribe", data: { runId: anaRun, fromSeq: 1 } }),
    );
    await eventually(() =>
      expect(colleague.frames.some((frame) => frame.event === "run.event")).toBe(true),
    );
    expect(
      colleague.frames
        .filter((frame) => frame.event === "run.event")
        .every((frame) => (frame.data as { runId: string }).runId === anaRun),
    ).toBe(true);
  });

  it("'pode editar' edita e publica como um membro, mas não gerencia o acesso", async () => {
    const dona = await member("dona");
    const edita = await member("edita");
    const id = await restricted(dona);
    await grant(dona, id, edita, "edit");

    expect(await listed(edita, id)).toMatchObject({ access: { level: "edit" } });
    expect((await api(edita, "GET", `/graphs/${id}`)).json()).toMatchObject({
      draft: { nodes: ["rascunho"] },
    });
    expect((await api(edita, "PATCH", `/graphs/${id}`, { name: "Novo" })).statusCode).toBe(200);
    const version = await publish(edita, id);
    expect((await api(edita, "GET", `/graphs/${id}/triggers/gatilho`)).statusCode).toBe(200);
    const started = await run(edita, version);
    expect((await api(dona, "GET", `/runs/${started}`)).statusCode).toBe(200);
    expect((await api(edita, "GET", `/graphs/${id}/access`)).statusCode).toBe(404);
    expect((await grant(edita, id, alice, "use")).statusCode).toBe(404);
  });

  it("o papel é o teto: leitor liberado só vê, sem rodar", async () => {
    const dona = await member("dona");
    const leitor = await member("leitor", "viewer");
    const id = await restricted(dona);
    const version = await publish(dona, id);
    expect((await api(leitor, "GET", `/graphs/${id}`)).statusCode).toBe(404);
    expect((await grant(dona, id, leitor, "edit")).statusCode).toBe(200);

    expect(await listed(leitor, id)).toMatchObject({ access: { level: "view" } });
    expect((await api(leitor, "GET", `/graphs/${id}`)).statusCode).toBe(200);
    expect(
      (await api(leitor, "POST", "/runs", { graphVersionId: version, input: "oi" })).statusCode,
    ).toBe(403);
    expect((await api(leitor, "PATCH", `/graphs/${id}`, { name: "x" })).statusCode).toBe(403);
  });

  it("aberto à organização: cada membro com o acesso do seu papel; restrito de novo, só os liberados", async () => {
    const dona = await member("dona");
    const colega = await member("colega");
    const leitor = await member("leitor", "viewer");
    const id = await restricted(dona);
    await publish(dona, id);
    expect((await listed(colega, id)).access.level).toBe("none");

    const opened = await api(dona, "PUT", `/graphs/${id}/access/mode`, { mode: "organization" });
    expect(opened.statusCode).toBe(200);
    expect(opened.json<AccessDetails>().mode).toBe("organization");
    expect((await listed(colega, id)).access.level).toBe("edit");
    expect((await listed(leitor, id)).access.level).toBe("view");
    expect((await api(colega, "PATCH", `/graphs/${id}`, { name: "Aberto" })).statusCode).toBe(200);

    await api(dona, "PUT", `/graphs/${id}/access/mode`, { mode: "restricted" });
    expect((await listed(colega, id)).access.level).toBe("none");
    expect((await listed(leitor, id)).access.level).toBe("none");
  });

  it("os projetos que já existiam ficam abertos à organização", async () => {
    const colega = await member("colega");
    const old = await graph(alice);
    await db.database.db.execute(
      sql`update graphs set owner_user_id = null, access_mode = 'organization' where id = ${old}`,
    );
    expect(await listed(colega, old)).toMatchObject({
      accessMode: "organization",
      owner: null,
      access: { level: "edit" },
    });
  });

  it("bloqueado fica sem acesso, mesmo no projeto aberto, e não pode pedir de novo", async () => {
    const dona = await member("dona");
    const colega = await member("colega");
    const id = await restricted(dona);
    await api(dona, "PUT", `/graphs/${id}/access/mode`, { mode: "organization" });

    const blocked = await api(dona, "PUT", `/graphs/${id}/access/${colega.userId}`, {
      status: "blocked",
    });
    expect(blocked.statusCode).toBe(200);
    expect(await listed(colega, id)).toMatchObject({
      access: { level: "none", request: "blocked" },
    });
    expect((await api(colega, "GET", `/graphs/${id}`)).statusCode).toBe(404);
    const again = await api(colega, "POST", `/graphs/${id}/access-request`);
    expect(again.statusCode).toBe(403);
    expect(again.json()).toMatchObject({ code: "graph_access_blocked" });

    expect((await api(dona, "DELETE", `/graphs/${id}/access/${colega.userId}`)).statusCode).toBe(
      204,
    );
    expect((await listed(colega, id)).access.level).toBe("edit");
  });

  it("não bloqueia nem libera quem já tem acesso total, nem quem não é da organização", async () => {
    const dona = await member("dona");
    const id = await restricted(dona);
    for (const target of [alice, dona]) {
      const reply = await api(dona, "PUT", `/graphs/${id}/access/${target.userId}`, {
        status: "blocked",
      });
      expect(reply.statusCode).toBe(409);
      expect(reply.json()).toMatchObject({ code: "graph_access_protected" });
    }
    expect((await grant(dona, id, alice, "use")).statusCode).toBe(409);
    const stranger = await api(dona, "PUT", `/graphs/${id}/access/${bob.userId}`, {
      status: "blocked",
    });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json()).toMatchObject({ code: "graph_access_member_not_found" });
    const missingLevel = await api(dona, "PUT", `/graphs/${id}/access/${alice.userId}`, {
      status: "granted",
    });
    expect(missingLevel.statusCode).toBe(400);
  });

  it("pedido de acesso: um por pessoa, o dono vê o contador, aprova com o nível e quem tem acesso não pede", async () => {
    const dona = await member("dona");
    const pessoa = await member("pessoa");
    const id = await restricted(dona);

    const asked = await api(pessoa, "POST", `/graphs/${id}/access-request`);
    expect(asked.statusCode).toBe(201);
    const duplicate = await api(pessoa, "POST", `/graphs/${id}/access-request`);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "graph_access_request_pending" });
    expect(await listed(pessoa, id)).toMatchObject({
      access: { level: "none", request: "pending", pendingRequests: 0 },
    });
    expect((await listed(dona, id)).access.pendingRequests).toBe(1);
    expect((await listed(alice, id)).access.pendingRequests).toBe(1);

    const details = (await api(dona, "GET", `/graphs/${id}/access`)).json<AccessDetails>();
    expect(details.entries).toMatchObject([
      { user: { id: pessoa.userId }, status: "requested", level: null },
    ]);

    const approved = await grant(dona, id, pessoa, "use");
    expect(approved.statusCode).toBe(200);
    expect(approved.json<AccessDetails>().entries).toMatchObject([
      { user: { id: pessoa.userId }, status: "granted", level: "use" },
    ]);
    expect(await listed(pessoa, id)).toMatchObject({ access: { level: "use", request: null } });
    expect((await listed(dona, id)).access.pendingRequests).toBe(0);
    const already = await api(pessoa, "POST", `/graphs/${id}/access-request`);
    expect(already.statusCode).toBe(409);
    expect(already.json()).toMatchObject({ code: "graph_access_already_granted" });
  });

  it("quem pediu cancela o pedido; recusar apaga o pedido e a pessoa pode pedir de novo", async () => {
    const dona = await member("dona");
    const pessoa = await member("pessoa");
    const id = await restricted(dona);
    const url = `/graphs/${id}/access-request`;

    expect((await api(pessoa, "DELETE", url)).statusCode).toBe(404);
    await api(pessoa, "POST", url);
    expect((await api(pessoa, "DELETE", url)).statusCode).toBe(204);
    expect((await listed(dona, id)).access.pendingRequests).toBe(0);

    await api(pessoa, "POST", url);
    expect((await api(dona, "DELETE", `/graphs/${id}/access/${pessoa.userId}`)).statusCode).toBe(
      204,
    );
    expect((await listed(pessoa, id)).access.request).toBeNull();
    expect((await api(pessoa, "POST", url)).statusCode).toBe(201);
    // Nobody but who asked cancels it through this route.
    expect((await api(dona, "DELETE", url)).statusCode).toBe(404);
    expect((await api(pessoa, "POST", `/graphs/${randomUUID()}/access-request`)).statusCode).toBe(
      404,
    );
  });

  it("quem sai da organização perde liberações, bloqueios e pedidos", async () => {
    const dona = await member("dona");
    const pessoa = await member("pessoa");
    const pedinte = await member("pedinte");
    const id = await restricted(dona);
    await grant(dona, id, pessoa, "edit");
    await api(pedinte, "POST", `/graphs/${id}/access-request`);
    const rowsOfPeople = async () =>
      rowsOf<{ total: number }>(
        await db.database.db.execute(
          sql`select count(*)::int as total from graph_access where graph_id = ${id}`,
        ),
      )[0]!.total;
    expect(await rowsOfPeople()).toBe(2);

    await accounts.setMember(alice.userId, alice.organizationId, pessoa.userId, null);
    await accounts.setMember(alice.userId, alice.organizationId, pedinte.userId, null);
    expect(await rowsOfPeople()).toBe(0);
    // Back in the organization, they start from the mode of the project.
    await accounts.setMember(alice.userId, alice.organizationId, pessoa.userId, "member");
    const back = asActor(
      await sessions.issue(pessoa.userId, alice.organizationId),
      pessoa.userId,
      alice.organizationId,
    );
    expect((await listed(back, id)).access.level).toBe("none");
  });

  it("o gatilho continua disparando num projeto restrito, e a execução dele só aparece a quem edita", async () => {
    const dona = await member("dona");
    const usa = await member("usa");
    const id = await restricted(dona);
    const fixture = buildTestGraph();
    await publish(dona, id, {
      nodes: fixture.nodes.map((node) =>
        node.type === "trigger" ? { ...node, kind: "webhook" } : node,
      ),
    });
    await grant(dona, id, usa, "use");
    // Rotating the secret asks for credential management, which only owners and admins have.
    const secretReply = await api(alice, "POST", `/graphs/${id}/triggers/gatilho/secret`);
    expect(secretReply.statusCode).toBe(201);
    const data = secretReply.json<{ secret: string; state: { hookPath: string } }>();
    expect(
      (await api(alice, "PUT", `/graphs/${id}/triggers/gatilho/enabled`, { enabled: true }))
        .statusCode,
    ).toBe(200);
    const timestamp = String(Math.floor(Date.now() / 1000)),
      body = "evento";
    const signature = createHmac("sha256", data.secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(
      `http://127.0.0.1:${app.get(HooksServer).port}${data.state.hookPath}`,
      {
        method: "POST",
        body,
        headers: {
          "content-type": "text/plain",
          "x-neurons-timestamp": timestamp,
          "x-neurons-signature": `sha256=${signature}`,
        },
      },
    );
    expect(response.status).toBe(202);
    const started = (await response.json()) as { runId: string };
    expect((await api(dona, "GET", `/runs/${started.runId}`)).statusCode).toBe(200);
    expect((await api(alice, "GET", `/runs/${started.runId}`)).statusCode).toBe(200);
    // A trigger has no user: who only uses the project never sees what it started.
    expect((await api(usa, "GET", `/runs/${started.runId}`)).statusCode).toBe(404);
    expect(await runIdsOf(usa)).toEqual([]);
  });
});
