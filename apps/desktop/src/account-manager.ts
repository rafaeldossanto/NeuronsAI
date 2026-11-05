import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DesktopAccountStore } from "./account-store.js";
import { NativeLogin } from "./native-login.js";
import { cookiePrefix, remoteOrigin } from "./remote-origin.js";
import {
  credentialCookies,
  RemoteSessionExpiredError,
  restoreRemoteSession,
  type AccountCookie,
} from "./remote-session.js";

export interface CookieView {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  hostOnly?: boolean;
  expirationDate?: number;
}
export interface CookieJar {
  get(filter: { url: string; name?: string }): Promise<CookieView[]>;
  set(cookie: AccountCookie): Promise<void>;
  remove(url: string, name: string): Promise<void>;
}
export interface DesktopAccountState {
  mode: "local" | "remote";
  serverOrigin: string | null;
  error?: string;
}
interface Options {
  dataDir: string;
  localOrigin: string;
  store: Pick<DesktopAccountStore, "load" | "save" | "clear" | "ensureAvailable">;
  cookies: (origin: string) => CookieJar;
  show: (origin: string) => Promise<void>;
  openBrowser: (url: string) => Promise<void>;
  transport?: typeof fetch;
}

/** All account credentials stay in the main process, HttpOnly cookies or the OS-backed store. */
export class DesktopAccountManager {
  private preferred: string | null = null;
  private mode: "local" | "remote" = "local";
  private connecting = false;
  private error?: string;
  private readonly login: NativeLogin;
  private readonly transport: typeof fetch;
  private persistence = Promise.resolve();
  private readonly applyingCookies = new Set<string>();
  private readonly preferenceFile: string;
  constructor(private readonly options: Options) {
    this.transport = options.transport ?? fetch;
    this.login = new NativeLogin(options.openBrowser, this.transport);
    this.preferenceFile = path.join(options.dataDir, "desktop-connection.json");
  }
  state(): DesktopAccountState {
    return {
      mode: this.mode,
      serverOrigin: this.preferred,
      ...(this.error && { error: this.error }),
    };
  }
  async initialize(): Promise<void> {
    try {
      const data = z
        .object({ serverOrigin: z.string() })
        .parse(JSON.parse(await readFile(this.preferenceFile, "utf8")));
      this.preferred = remoteOrigin(data.serverOrigin);
      await this.connect(this.preferred);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.error =
          "Não foi possível abrir a conexão salva. Você pode continuar no espaço local e tentar novamente.";
      this.mode = "local";
    }
  }
  async connect(value: string): Promise<void> {
    if (this.connecting)
      throw new Error("Já existe uma conexão em andamento. Aguarde e tente novamente.");
    this.connecting = true;
    try {
      await this.connectServer(value);
    } finally {
      this.connecting = false;
    }
  }
  private async connectServer(value: string): Promise<void> {
    const origin = remoteOrigin(value);
    if (origin === this.options.localOrigin)
      throw new Error("Este é o endereço do seu espaço local. Informe o servidor compartilhado.");
    this.options.store.ensureAvailable();
    try {
      const result = await this.transport(`${origin}/api/auth/desktop/config`, {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      const parsed = z
        .object({ enabled: z.boolean(), protocolVersion: z.literal(1) })
        .safeParse(await result.json());
      if (!result.ok || !parsed.success || !parsed.data.enabled) throw new Error();
    } catch {
      throw new Error(
        "O servidor precisa oferecer a interface NeuronsAI com login Google e suporte ao aplicativo desktop.",
      );
    }
    const jar = this.options.cookies(origin);
    await this.flush();
    const memoryCookies = await jar.get({ url: origin });
    const prefix = cookiePrefix(origin);
    const live = memoryCookies.some(
      (cookie) =>
        cookie.name === `${prefix}access` &&
        cookie.httpOnly &&
        cookie.path === "/" &&
        cookie.expirationDate &&
        cookie.expirationDate > Date.now() / 1000,
    );
    let saved;
    try {
      saved = await this.options.store.load(origin);
    } catch {
      await this.options.store.clear(origin);
    }
    if (saved && !live) {
      try {
        const cookies = await restoreRemoteSession(origin, saved.refreshToken, this.transport);
        await this.applyCookies(origin, cookies);
      } catch (error) {
        if (!(error instanceof RemoteSessionExpiredError)) throw error;
        await this.options.store.clear(origin);
        await this.clearCookies(origin);
      }
    }
    await this.writePreference(origin);
    this.preferred = origin;
    this.mode = "remote";
    this.error = undefined;
    try {
      await this.options.show(origin);
    } catch {
      this.mode = "local";
      this.error =
        "Não foi possível abrir a interface do servidor. Você pode continuar no espaço local.";
      await this.options.show(this.options.localOrigin);
    }
  }
  async signIn(): Promise<void> {
    if (this.mode !== "remote" || !this.preferred)
      throw new Error("Abra um servidor antes de entrar.");
    const origin = this.preferred;
    this.options.store.ensureAvailable();
    const credentials = await this.login.begin(origin);
    if (this.mode !== "remote" || this.preferred !== origin)
      throw new Error("A conexão mudou. Inicie a entrada novamente.");
    const cookies = credentialCookies(origin, credentials);
    await this.applyCookies(origin, cookies);
    await this.options.show(origin);
  }
  cancelLogin(): void {
    this.login.cancel();
  }
  async openLocal(): Promise<void> {
    this.login.cancel();
    this.mode = "local";
    this.error = undefined;
    await this.options.show(this.options.localOrigin);
  }
  async forget(): Promise<void> {
    this.login.cancel();
    const origin = this.preferred;
    if (origin) {
      const cookies = await this.options.cookies(origin).get({ url: origin });
      const prefix = cookiePrefix(origin);
      const csrf = cookies.find(
        (cookie) => cookie.name === `${prefix}csrf` && cookie.path === "/",
      )?.value;
      if (csrf)
        await this.transport(`${origin}/api/auth/logout`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Origin: origin,
            "x-neurons-csrf": csrf,
            Cookie: cookies
              .filter(
                (cookie) =>
                  ["access", "refresh", "csrf"].some(
                    (kind) => cookie.name === `${prefix}${kind}`,
                  ) && cookie.path === "/",
              )
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; "),
          },
        }).catch(() => {});
      await this.clearCookies(origin);
      await this.flush();
      await this.options.store.clear(origin);
    }
    await rm(this.preferenceFile, { force: true });
    this.preferred = null;
    await this.openLocal();
  }
  /** Cookie rotations in the remote web app (including organization changes/logout) update the OS store. */
  cookiesChanged(origin: string): void {
    if (this.applyingCookies.has(origin)) return;
    this.persistence = this.persistence
      .then(async () => {
        const prefix = cookiePrefix(origin);
        const cookies = await this.options
          .cookies(origin)
          .get({ url: origin, name: `${prefix}refresh` });
        const candidates = cookies.filter(
          (cookie) =>
            cookie.path === "/" &&
            cookie.httpOnly &&
            cookie.hostOnly !== false &&
            cookie.domain === new URL(origin).hostname &&
            (!origin.startsWith("https:") || cookie.secure),
        );
        if (
          candidates.length === 1 &&
          /^nsr_[A-Za-z0-9_-]{43}$/.test(candidates[0]!.value) &&
          candidates[0]!.expirationDate &&
          candidates[0]!.expirationDate > Date.now() / 1000
        ) {
          await this.options.store.save({
            serverOrigin: origin,
            refreshToken: candidates[0]!.value,
            expiresAt: new Date(candidates[0]!.expirationDate * 1000).toISOString(),
          });
        } else if (!cookies.length) await this.options.store.clear(origin);
      })
      .catch(() => {
        this.error =
          "Não foi possível guardar a sessão no cofre do sistema. Entre novamente ao reabrir o app.";
      });
  }
  async flush(): Promise<void> {
    await this.persistence;
  }
  async close(): Promise<void> {
    this.login.cancel();
    await this.flush();
  }
  private async clearCookies(origin: string) {
    for (const kind of ["access", "refresh", "csrf"])
      await this.options.cookies(origin).remove(origin, `${cookiePrefix(origin)}${kind}`);
  }
  private async saveCookies(origin: string, cookies: AccountCookie[]) {
    const refresh = cookies.find((cookie) => cookie.name === `${cookiePrefix(origin)}refresh`)!;
    const saving = this.persistence.then(() =>
      this.options.store.save({
        serverOrigin: origin,
        refreshToken: refresh.value,
        expiresAt: new Date(refresh.expirationDate * 1000).toISOString(),
      }),
    );
    this.persistence = saving.catch(() => {});
    await saving;
  }
  private async applyCookies(origin: string, cookies: AccountCookie[]) {
    this.applyingCookies.add(origin);
    try {
      await this.saveCookies(origin, cookies);
      for (const cookie of cookies) await this.options.cookies(origin).set(cookie);
    } finally {
      this.applyingCookies.delete(origin);
    }
  }
  private async writePreference(origin: string) {
    await mkdir(path.dirname(this.preferenceFile), { recursive: true });
    const temporary = `${this.preferenceFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ serverOrigin: origin }), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.preferenceFile);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
