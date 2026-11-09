import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config/app-config.js";

/** Host is never inferred from Origin or forwarded headers. CLI clients may omit Origin. */
export function allowsLocalRequest(request: IncomingMessage, config: AppConfig): boolean {
  if (config.auth) return true;
  const host = request.headers.host;
  if (!host) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
    if ((url.host !== host && `${url.hostname}:80` !== host) || url.username || url.password)
      return false;
  } catch {
    return false;
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]", config.host]);
  if (!allowedHosts.has(url.hostname)) return false;
  const port = request.socket.localPort ?? config.port;
  if (port && Number(url.port || 80) !== port) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://${host}`;
}
