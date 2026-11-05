import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopAccountManager, type CookieJar, type CookieView } from "./account-manager.js";
import type { DesktopAccountSession } from "./account-store.js";
import { credentialCookies } from "./remote-session.js";

const origin = "https://neurons.example.invalid",
  localOrigin = "http://127.0.0.1:43210";
const credentials = () => ({
  accessToken: `nsa_${"a".repeat(43)}`,
  refreshToken: `nsr_${"r".repeat(43)}`,
  accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
let directory: string;
beforeEach(async () => {
  directory = path.resolve(await mkdtemp(path.join(os.tmpdir(), "neurons-account-manager-")));
});
afterEach(async () => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^neurons-account-manager-/);
  await rm(directory, { recursive: true, force: true });
});
function fixture() {
  const saved = new Map<string, DesktopAccountSession>(),
    jars = new Map<string, Map<string, CookieView>>();
  const store = {
    ensureAvailable: vi.fn(() => {}),
    load: vi.fn((url: string) => Promise.resolve(saved.get(url))),
    save: vi.fn((value: DesktopAccountSession) => {
      saved.set(value.serverOrigin, value);
      return Promise.resolve();
    }),
    clear: vi.fn((url: string) => {
      saved.delete(url);
      return Promise.resolve();
    }),
  };
  const cookies = vi.fn((url: string): CookieJar => {
    let values = jars.get(url);
    if (!values) {
      values = new Map();
      jars.set(url, values);
    }
    const current = values;
    return {
      get: (filter) =>
        Promise.resolve(
          [...current.values()].filter((cookie) => !filter.name || cookie.name === filter.name),
        ),
      set: (cookie) => {
        current.set(cookie.name, { ...cookie, domain: new URL(url).hostname, hostOnly: true });
        return Promise.resolve();
      },
      remove: (_origin, name) => {
        current.delete(name);
        return Promise.resolve();
      },
    };
  });
  const show = vi.fn<(_url: string) => Promise<void>>(() => Promise.resolve());
  const transport = vi.fn<typeof fetch>((input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/config"))
      return Promise.resolve(Response.json({ enabled: true, protocolVersion: 1 }));
    if (url.endsWith("/exchange")) return Promise.resolve(Response.json(credentials()));
    const headers = new Headers();
    if (url.endsWith("/refresh"))
      for (const cookie of credentialCookies(origin, credentials()))
        headers.append(
          "Set-Cookie",
          `${cookie.name}=${cookie.value}; Path=/; Secure; Expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; ${cookie.httpOnly ? "HttpOnly;" : ""} SameSite=Strict`,
        );
    return Promise.resolve(new Response(null, { status: 204, headers }));
  });
  const openBrowser = vi.fn((value: string) => {
    const url = new URL(value),
      callback = new URL(url.searchParams.get("redirectUri")!);
    callback.searchParams.set("state", url.searchParams.get("state")!);
    callback.searchParams.set("code", "c".repeat(43));
    return fetch(callback).then(() => {});
  });
  const manager = new DesktopAccountManager({
    dataDir: directory,
    localOrigin,
    store,
    cookies,
    show,
    transport,
    openBrowser,
  });
  return { manager, store, saved, cookies, jars, show, transport, openBrowser };
}
describe("sessão remota no main", () => {
  it("serializa a conexão para não abrir janelas concorrentes durante a restauração inicial", async () => {
    const { manager, transport, show } = fixture();
    let release!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const first = manager.connect(origin);
    await expect(manager.connect("https://other.invalid")).rejects.toThrow("conexão em andamento");
    release(Response.json({ enabled: true, protocolVersion: 1 }));
    await first;
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(origin);
  });
  it("entra com navegador, salva somente refresh no cofre e não retorna tokens ao renderer", async () => {
    const { manager, store, jars, show, openBrowser } = fixture();
    await manager.connect(origin);
    await manager.signIn();
    expect(openBrowser).toHaveBeenCalledOnce();
    expect(store.save.mock.calls[0]![0]).toMatchObject({
      serverOrigin: origin,
      refreshToken: credentials().refreshToken,
    });
    expect(store.save.mock.calls[0]![0].expiresAt).toMatch(/^\d{4}-/);
    expect(JSON.stringify(manager.state())).not.toMatch(/nsa_|nsr_/);
    expect(jars.get(origin)!.get("__Host-neurons-refresh")?.httpOnly).toBe(true);
    const preferences = await readFile(path.join(directory, "desktop-connection.json"), "utf8");
    expect(JSON.parse(preferences)).toEqual({ serverOrigin: origin });
    expect(preferences).not.toMatch(/nsa_|nsr_/);
    expect(show).toHaveBeenLastCalledWith(origin);
  });
  it("restaura a renovação em memória e atualiza o cofre com a rotação do web", async () => {
    const { manager, saved, store, cookies, transport } = fixture();
    saved.set(origin, {
      serverOrigin: origin,
      refreshToken: credentials().refreshToken,
      expiresAt: credentials().expiresAt,
    });
    await manager.connect(origin);
    expect(
      transport.mock.calls.some(([url]) =>
        (url instanceof Request ? url.url : url.toString()).endsWith("/refresh"),
      ),
    ).toBe(true);
    const next = `nsr_${"n".repeat(43)}`;
    await cookies(origin).set({ ...credentialCookies(origin, credentials())[1]!, value: next });
    manager.cookiesChanged(origin);
    await manager.flush();
    expect(saved.get(origin)?.refreshToken).toBe(next);
    await cookies(origin).remove(origin, "__Host-neurons-refresh");
    manager.cookiesChanged(origin);
    await manager.flush();
    expect(store.clear).toHaveBeenCalledWith(origin);
    expect(saved.has(origin)).toBe(false);
  });
  it("volta ao local preservando a sessão e reabre sem disputar uma renovação desnecessária", async () => {
    const { manager, transport, saved } = fixture();
    await manager.connect(origin);
    await manager.signIn();
    await manager.openLocal();
    await manager.connect(origin);
    expect(
      transport.mock.calls.filter(([url]) =>
        (url instanceof Request ? url.url : url.toString()).endsWith("/refresh"),
      ),
    ).toHaveLength(0);
    expect(saved.has(origin)).toBe(true);
    expect(manager.state().mode).toBe("remote");
  });
  it("esquece somente o servidor escolhido, revoga a sessão e retorna ao espaço local", async () => {
    const { manager, saved, jars, transport } = fixture();
    const other = "https://other.invalid";
    saved.set(other, {
      serverOrigin: other,
      refreshToken: `nsr_${"o".repeat(43)}`,
      expiresAt: credentials().expiresAt,
    });
    await manager.connect(origin);
    await manager.signIn();
    await manager.openLocal();
    await manager.forget();
    expect(manager.state()).toMatchObject({ mode: "local", serverOrigin: null });
    expect(saved.has(origin)).toBe(false);
    expect(saved.has(other)).toBe(true);
    expect(jars.get(origin)?.size).toBe(0);
    expect(
      transport.mock.calls.some(
        ([url]) =>
          (url instanceof Request ? url.url : url.toString()) === `${origin}/api/auth/logout`,
      ),
    ).toBe(true);
  });
  it("fica local quando offline sem apagar a sessão protegida de outro servidor", async () => {
    const { manager, transport, saved } = fixture();
    saved.set(origin, {
      serverOrigin: origin,
      refreshToken: credentials().refreshToken,
      expiresAt: credentials().expiresAt,
    });
    await writeFile(
      path.join(directory, "desktop-connection.json"),
      JSON.stringify({ serverOrigin: origin }),
    );
    transport.mockRejectedValue(new Error("offline"));
    await manager.initialize();
    expect(manager.state()).toMatchObject({
      mode: "local",
      serverOrigin: origin,
    });
    expect(manager.state().error).toContain("espaço local");
    expect(saved.has(origin)).toBe(true);
  });
  it("recusa cofre indisponível antes de abrir o servidor ou transmitir credenciais", async () => {
    const { manager, store, transport, show } = fixture();
    store.ensureAvailable.mockImplementation(() => {
      throw new Error("armazenamento protegido indisponível");
    });
    await expect(manager.connect(origin)).rejects.toThrow("armazenamento protegido");
    expect(transport).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
});
