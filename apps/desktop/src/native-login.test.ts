import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeLogin } from "./native-login.js";
import { remoteOrigin } from "./remote-origin.js";
import { credentialCookies, restoreRemoteSession } from "./remote-session.js";

const origin = "https://neurons.example.invalid";
const credentials = () => ({
  accessToken: `nsa_${"a".repeat(43)}`,
  refreshToken: `nsr_${"r".repeat(43)}`,
  accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
const pending: NativeLogin[] = [];
afterEach(() => {
  for (const login of pending.splice(0)) login.cancel();
});
async function start(
  transport: typeof fetch = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(credentials())),
  ),
) {
  let opened!: (url: string) => void;
  const browser = new Promise<string>((resolve) => {
    opened = resolve;
  });
  const login = new NativeLogin((url) => {
    opened(url);
    return Promise.resolve();
  }, transport);
  pending.push(login);
  const result = login.begin(origin);
  const url = new URL(await browser),
    callback = new URL(url.searchParams.get("redirectUri")!);
  callback.searchParams.set("state", url.searchParams.get("state")!);
  callback.searchParams.set("code", "c".repeat(43));
  return { login, result, url, callback, transport };
}

describe("entrada nativa", () => {
  it("cancela antes da abertura do navegador sem iniciar outra navegação", async () => {
    const browser = vi.fn(() => Promise.resolve());
    const login = new NativeLogin(browser);
    pending.push(login);
    const result = login.begin(origin);
    const rejected = expect(result).rejects.toThrow("cancelada");
    login.cancel();
    await rejected;
    expect(browser).not.toHaveBeenCalled();
  });
  it("encerra a espera quando o retorno expira", async () => {
    const login = new NativeLogin(() => Promise.resolve(), fetch, 25);
    pending.push(login);
    await expect(login.begin(origin)).rejects.toThrow("expirou");
  });
  it("usa callback real em loopback e troca código apenas no main com PKCE", async () => {
    const { result, callback, url, transport } = await start();
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/api/auth/desktop");
    expect(url.searchParams.has("codeVerifier")).toBe(false);
    const received = await fetch(callback);
    expect(received.status).toBe(200);
    expect(await received.text()).not.toMatch(/nsa_|nsr_|cccccccc/);
    expect((await result).refreshToken).toMatch(/^nsr_/);
    const call = vi.mocked(transport).mock.calls[0]!;
    expect(call[0]).toBe(`${origin}/api/auth/desktop/exchange`);
    const body = JSON.parse(call[1]!.body as string) as {
      codeVerifier: string;
      redirectUri: string;
    };
    expect(createHash("sha256").update(body.codeVerifier).digest("base64url")).toBe(
      url.searchParams.get("codeChallenge"),
    );
    expect(body.redirectUri).toBe(url.searchParams.get("redirectUri"));
    await expect(fetch(callback)).rejects.toThrow();
  });
  it("ignora state errado sem trocar o código e aceita o retorno legítimo", async () => {
    const { result, callback, transport } = await start();
    const bad = new URL(callback);
    bad.searchParams.set("state", "z".repeat(43));
    expect((await fetch(bad)).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
    expect((await fetch(callback)).status).toBe(200);
    await result;
  });
  it("cancela e fecha o callback sem aceitar um retorno posterior", async () => {
    const { login, result, callback } = await start();
    const rejected = expect(result).rejects.toThrow("cancelada");
    login.cancel();
    await rejected;
    await expect(fetch(callback)).rejects.toThrow();
  });
  it("não expõe erro de transporte que contenha credenciais", async () => {
    const transport = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("private-request-body-token")),
    );
    const { result, callback } = await start(transport);
    const rejected = expect(result).rejects.not.toThrow("private-request-body-token");
    await fetch(callback);
    await rejected;
  });
  it("recebe recusa do navegador sem criar sessão", async () => {
    const { result, callback, transport } = await start();
    callback.searchParams.delete("code");
    callback.searchParams.set("error", "access_denied");
    const rejected = expect(result).rejects.toThrow("não foi autorizada");
    await fetch(callback);
    await rejected;
    expect(transport).not.toHaveBeenCalled();
  });
});
describe("origem e cookies do servidor", () => {
  it.each([
    "http://remote.invalid",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com/?token=secret",
    "file:///tmp/app",
    "javascript:alert(1)",
  ])("recusa %s", (url) => {
    expect(() => remoteOrigin(url)).toThrow("origem HTTPS");
  });
  it("cria somente cookies host-only, com credenciais HttpOnly e CSRF separado", () => {
    const cookies = credentialCookies(origin, credentials());
    expect(cookies.map((cookie) => [cookie.name, cookie.httpOnly, cookie.secure])).toEqual([
      ["__Host-neurons-access", true, true],
      ["__Host-neurons-refresh", true, true],
      ["__Host-neurons-csrf", false, true],
    ]);
    expect(cookies.every((cookie) => !Object.hasOwn(cookie, "domain"))).toBe(true);
  });
  it("restaura e rotaciona somente para a mesma origem, sem seguir redirecionamentos", async () => {
    const next = credentials();
    const headers = new Headers();
    for (const cookie of credentialCookies(origin, next))
      headers.append(
        "Set-Cookie",
        `${cookie.name}=${cookie.value}; Path=/; Expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; Secure${cookie.httpOnly ? "; HttpOnly" : ""}; SameSite=Strict`,
      );
    const transport = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204, headers })),
    );
    const restored = await restoreRemoteSession(origin, next.refreshToken, transport);
    expect(
      restored.find((cookie) => cookie.httpOnly && cookie.name.endsWith("refresh"))?.value,
    ).toBe(next.refreshToken);
    expect(transport.mock.calls[0]![1]).toMatchObject({
      redirect: "error",
      headers: { Origin: origin },
    });
    expect(JSON.stringify(transport.mock.calls[0]![0])).not.toContain(next.refreshToken);
  });
  it("recusa cookies de domínio e credenciais legíveis por JavaScript", async () => {
    for (const attributes of ["Domain=example.invalid; HttpOnly", ""]) {
      const headers = new Headers({
        "Set-Cookie": `__Host-neurons-access=${credentials().accessToken}; Path=/; Secure; Expires=${new Date(Date.now() + 600_000).toUTCString()}; ${attributes}`,
      });
      await expect(
        restoreRemoteSession(origin, credentials().refreshToken, () =>
          Promise.resolve(new Response(null, { status: 204, headers })),
        ),
      ).rejects.toThrow("cookies de sessão inválidos");
    }
  });
});
