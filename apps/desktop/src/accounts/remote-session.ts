import { randomBytes } from "node:crypto";
import { cookiePrefix, remoteOrigin } from "./remote-origin.js";
import { nativeCredentials, type NativeCredentials } from "./native-login.js";

export class RemoteSessionExpiredError extends Error {
  constructor() {
    super("Entre novamente para abrir este servidor.");
  }
}

/** Shape accepted by Electron Cookies.set; kept free of Electron so transport rules are testable. */
export interface AccountCookie {
  url: string;
  name: string;
  value: string;
  path: "/";
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict";
  expirationDate: number;
}
export function credentialCookies(
  origin: string,
  credentials: NativeCredentials,
  csrf = randomBytes(32).toString("base64url"),
): AccountCookie[] {
  const parsed = nativeCredentials.parse(credentials),
    prefix = cookiePrefix(origin);
  return (
    [
      ["access", parsed.accessToken, parsed.accessExpiresAt],
      ["refresh", parsed.refreshToken, parsed.expiresAt],
      ["csrf", csrf, parsed.expiresAt],
    ] as const
  ).map(([kind, value, expiresAt]) => ({
    url: origin,
    name: `${prefix}${kind}`,
    value,
    path: "/",
    httpOnly: kind !== "csrf",
    secure: origin.startsWith("https:"),
    sameSite: kind === "access" ? "lax" : "strict",
    expirationDate: Date.parse(expiresAt) / 1000,
  }));
}

/** Restore through the same rotating session endpoint as the web app; no credentials in IPC. */
export async function restoreRemoteSession(
  value: string,
  refreshToken: string,
  transport: typeof fetch = fetch,
): Promise<AccountCookie[]> {
  const origin = remoteOrigin(value),
    prefix = cookiePrefix(origin),
    csrf = randomBytes(32).toString("base64url");
  if (!/^nsr_[A-Za-z0-9_-]{43}$/.test(refreshToken))
    throw new Error("Entre novamente para abrir este servidor.");
  let response: Response;
  try {
    response = await transport(`${origin}/api/auth/refresh`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Origin: origin,
        Cookie: `${prefix}refresh=${refreshToken}; ${prefix}csrf=${csrf}`,
        "x-neurons-csrf": csrf,
      },
    });
  } catch {
    throw new Error("Não foi possível falar com o servidor. Você pode continuar no espaço local.");
  }
  if (response.status === 403) throw new RemoteSessionExpiredError();
  if (response.status !== 204)
    throw new Error("O servidor não conseguiu renovar a sessão. Tente novamente.");
  const values = new Map<string, { value: string; expiresAt: string }>();
  for (const header of response.headers.getSetCookie()) {
    const [entry, ...attributes] = header.split(";").map((part) => part.trim());
    const separator = entry!.indexOf("=");
    const name = entry!.slice(0, separator),
      value = entry!.slice(separator + 1);
    if (![`${prefix}access`, `${prefix}refresh`, `${prefix}csrf`].includes(name)) continue;
    const fields = new Map(
      attributes.map((field) => {
        const index = field.indexOf("=");
        return index < 0
          ? [field.toLowerCase(), ""]
          : [field.slice(0, index).toLowerCase(), field.slice(index + 1)];
      }),
    );
    if (
      values.has(name) ||
      fields.has("domain") ||
      fields.get("path") !== "/" ||
      (origin.startsWith("https:") && !fields.has("secure")) ||
      (name !== `${prefix}csrf` && !fields.has("httponly"))
    )
      throw new Error("O servidor retornou cookies de sessão inválidos.");
    const expires = Date.parse(fields.get("expires") ?? "");
    if (!Number.isFinite(expires))
      throw new Error("O servidor retornou cookies de sessão inválidos.");
    values.set(name, { value, expiresAt: new Date(expires).toISOString() });
  }
  const parsed = nativeCredentials.safeParse({
    accessToken: values.get(`${prefix}access`)?.value,
    refreshToken: values.get(`${prefix}refresh`)?.value,
    accessExpiresAt: values.get(`${prefix}access`)?.expiresAt,
    expiresAt: values.get(`${prefix}refresh`)?.expiresAt,
  });
  const serverCsrf = values.get(`${prefix}csrf`)?.value;
  if (!parsed.success || !serverCsrf || !/^[A-Za-z0-9_-]{43}$/.test(serverCsrf))
    throw new Error("O servidor retornou cookies de sessão inválidos.");
  return credentialCookies(origin, parsed.data, serverCsrf);
}
