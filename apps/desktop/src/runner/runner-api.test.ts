import { describe, expect, it, vi } from "vitest";
import type { CookieJar, CookieView } from "../accounts/account-manager.js";
import { RunnerApi, RunnerIssueError } from "./runner-api.js";

const ORIGIN = "https://neurons.example.invalid";
const CSRF = "csrf-falso";
const cookie = (name: string, value: string): CookieView => ({ name, value, path: "/" });
const jar = (cookies: CookieView[]): CookieJar => ({
  get: () => Promise.resolve(cookies),
  set: () => Promise.resolve(),
  remove: () => Promise.resolve(),
});
const session = [
  cookie("__Host-neurons-access", "acesso-falso"),
  cookie("__Host-neurons-refresh", "refresh-falso"),
  cookie("__Host-neurons-csrf", CSRF),
  cookie("outro", "x"),
];
const reply = (status: number, body?: unknown) =>
  vi.fn(() => Promise.resolve(new Response(body ? JSON.stringify(body) : null, { status })));
const asFetch = (mock: ReturnType<typeof reply>) => mock as unknown as typeof fetch;
const calls = (mock: ReturnType<typeof reply>) =>
  mock.mock.calls as unknown as [string, RequestInit][];

describe("RunnerApi", () => {
  it("issues a personal token with the session's cookies, Origin and CSRF header", async () => {
    const transport = reply(201, { id: "r1", name: "meu-pc", token: "tok-falso" });
    const api = new RunnerApi({ cookies: () => jar(session), transport: asFetch(transport) });
    await expect(api.issue(ORIGIN, "personal", "meu-pc")).resolves.toEqual({
      id: "r1",
      name: "meu-pc",
      token: "tok-falso",
    });
    const [url, init] = calls(transport)[0]!;
    expect(url).toBe(`${ORIGIN}/api/runners/personal`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "meu-pc" }));
    expect(init.headers).toMatchObject({ Origin: ORIGIN, "x-neurons-csrf": CSRF });
    const cookies = (init.headers as Record<string, string>).Cookie!;
    expect(cookies).toContain("__Host-neurons-access=acesso-falso");
    expect(cookies).not.toContain("outro");
  });

  it("uses the organization path for the organization mode", async () => {
    const transport = reply(201, { id: "r2", name: "meu-pc", token: "tok-falso" });
    await new RunnerApi({ cookies: () => jar(session), transport: asFetch(transport) }).issue(
      ORIGIN,
      "organization",
      "meu-pc",
    );
    expect(calls(transport)[0]![0]).toBe(`${ORIGIN}/api/runners`);
  });

  it("maps the server's answers to a reason", async () => {
    const kinds: [number, string][] = [
      [401, "signed-out"],
      [403, "forbidden"],
      [409, "conflict"],
      [500, "failed"],
    ];
    for (const [status, kind] of kinds) {
      const api = new RunnerApi({
        cookies: () => jar(session),
        transport: asFetch(reply(status)),
      });
      await expect(api.issue(ORIGIN, "organization", "x")).rejects.toMatchObject({ kind });
    }
    const bad = new RunnerApi({
      cookies: () => jar(session),
      transport: asFetch(reply(201, { id: 1 })),
    });
    await expect(bad.issue(ORIGIN, "personal", "x")).rejects.toMatchObject({ kind: "failed" });
  });

  it("does not call the server without a signed-in session", async () => {
    const transport = reply(201);
    const api = new RunnerApi({ cookies: () => jar([]), transport: asFetch(transport) });
    await expect(api.issue(ORIGIN, "personal", "x")).rejects.toBeInstanceOf(RunnerIssueError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("revokes a personal token by id and an organization one by name", async () => {
    const transport = reply(204);
    const api = new RunnerApi({ cookies: () => jar(session), transport: asFetch(transport) });
    await api.revoke({ serverOrigin: ORIGIN, mode: "personal", id: "r 1", name: "pc", token: "t" });
    await api.revoke({
      serverOrigin: ORIGIN,
      mode: "organization",
      id: "r2",
      name: "meu pc",
      token: "t",
    });
    const made = calls(transport);
    expect(made[0]![0]).toBe(`${ORIGIN}/api/runners/personal/r%201`);
    expect(made[1]![0]).toBe(`${ORIGIN}/api/runners/meu%20pc`);
    expect(made.every(([, init]) => init.method === "DELETE")).toBe(true);
  });
});
