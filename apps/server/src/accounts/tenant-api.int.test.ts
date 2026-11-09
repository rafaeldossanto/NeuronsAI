import { createHmac, randomBytes } from "node:crypto";
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
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
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
async function graph(who: Actor, name = "Projeto") {
  const created = await api(who, "POST", "/graphs", { name });
  expect(created.statusCode).toBe(201);
  return created.json<{ id: string }>().id;
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
