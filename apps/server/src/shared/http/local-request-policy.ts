import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { AppConfig } from "../config/app-config.js";
import { isLoopbackHost } from "../config/listen-config.js";

/**
 * Host is never inferred from Origin or forwarded headers. CLI clients may omit Origin.
 *
 * On loopback only loopback names are accepted (DNS rebinding sends a foreign name). When the
 * operator opted into listening beyond loopback (`NEURONS_ALLOW_REMOTE`), the machine is reached by
 * its network address too: any IP literal is accepted, since a rebinding page cannot make the
 * browser send one; names must be `localhost` or the configured `NEURONS_HOST`.
 */
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
  const reachableByAddress =
    !isLoopbackHost(config.host) && isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0;
  if (!allowedHosts.has(url.hostname) && !reachableByAddress) return false;
  const port = request.socket.localPort ?? config.port;
  if (port && Number(url.port || 80) !== port) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://${host}`;
}
