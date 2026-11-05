import { randomBytes, timingSafeEqual } from "node:crypto";
import { AccountSessionsService, type SessionCredentials } from "./account-sessions.service.js";
import { InvalidSessionError } from "./account.errors.js";
import { LoginAttemptError } from "./login.errors.js";

export interface BrowserRequest {
  headers: Record<string, string | string[] | undefined>;
}

/** HttpOnly credentials, host-only cookies, same-origin mutation checks and double-submit CSRF. */
export class BrowserSession {
  private readonly secure: boolean;
  private readonly prefix: string;
  constructor(
    private readonly sessions: AccountSessionsService,
    private readonly origin: string,
  ) {
    const url = new URL(origin);
    this.secure = url.protocol === "https:";
    if (
      origin !== url.origin ||
      (!this.secure && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
      throw new Error("A origem de autenticação deve usar HTTPS ou loopback local.");
    this.prefix = this.secure ? "__Host-neurons-" : "neurons-";
  }

  setCredentials(credentials: SessionCredentials): string[] {
    const csrf = randomBytes(32).toString("base64url");
    return [
      this.cookie("access", credentials.accessToken, credentials.accessExpiresAt, true, "Lax"),
      this.cookie("refresh", credentials.refreshToken, credentials.expiresAt, true, "Strict"),
      this.cookie("csrf", csrf, credentials.expiresAt, false, "Strict"),
    ];
  }

  async authenticate(request: BrowserRequest) {
    return this.sessions.authenticate(this.read(request, "access"));
  }

  requireSameOrigin(request: BrowserRequest): void {
    if (
      request.headers.origin !== this.origin ||
      (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin")
    )
      throw new InvalidSessionError();
  }

  requireMutation(request: BrowserRequest): void {
    this.requireSameOrigin(request);
    const cookie = this.read(request, "csrf");
    const header = request.headers["x-neurons-csrf"];
    if (!/^[A-Za-z0-9_-]{43}$/.test(cookie) || typeof header !== "string" || !equal(cookie, header))
      throw new InvalidSessionError();
  }

  csrfToken(request: BrowserRequest): string {
    return this.read(request, "csrf");
  }

  async refresh(request: BrowserRequest): Promise<string[]> {
    this.requireMutation(request);
    return this.setCredentials(await this.sessions.refresh(this.read(request, "refresh")));
  }

  async logout(request: BrowserRequest): Promise<string[]> {
    this.requireMutation(request);
    const token = this.read(request, "refresh");
    if (token) await this.sessions.revoke(token);
    return ["access", "refresh", "csrf", "login"].map((name) =>
      this.cookie(name, "", new Date(0), name !== "csrf", "Strict"),
    );
  }

  loginCookie(binding: string, expiresAt: Date): string {
    return this.cookie("login", binding, expiresAt, true, "Lax");
  }

  loginBinding(request: BrowserRequest): string {
    const value = this.read(request, "login");
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new LoginAttemptError();
    return value;
  }

  clearLoginCookie(): string {
    return this.cookie("login", "", new Date(0), true, "Lax");
  }

  private cookie(
    name: string,
    value: string,
    expiresAt: Date,
    httpOnly: boolean,
    sameSite: "Strict" | "Lax",
  ) {
    return `${this.prefix}${name}=${encodeURIComponent(value)}; Path=/; Expires=${expiresAt.toUTCString()}; SameSite=${sameSite}${this.secure ? "; Secure" : ""}${httpOnly ? "; HttpOnly" : ""}`;
  }

  private read(request: BrowserRequest, name: string): string {
    const header = request.headers.cookie;
    if (typeof header !== "string" || header.length > 16_384) return "";
    const entries = header
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${this.prefix}${name}=`));
    if (entries.length !== 1) return "";
    try {
      return decodeURIComponent(entries[0]!.slice(`${this.prefix}${name}=`.length));
    } catch {
      return "";
    }
  }
}

function equal(a: string, b: string): boolean {
  const first = Buffer.from(a),
    second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
