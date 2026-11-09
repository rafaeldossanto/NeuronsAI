// Pure rules, free of Electron, so they are tested without it.

/** Schemes the window may use towards the app's own server. */
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
/** Schemes that carry no network traffic and that the interface and the browser itself use. */
const LOCAL_SCHEMES = new Set(["data:", "blob:", "devtools:"]);

/**
 * Whether the window may request `url`: the app's server (same host and port, HTTP or WebSocket)
 * and local `data:`/`blob:` URLs. Nothing else leaves the window.
 */
export function isAllowedRequest(url: string, serverOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true;
  if (!NETWORK_SCHEMES.has(parsed.protocol)) return false;
  const server = new URL(serverOrigin);
  const schemes = server.protocol === "https:" ? ["https:", "wss:"] : ["http:", "ws:"];
  return (
    !parsed.username &&
    !parsed.password &&
    parsed.host === server.host &&
    schemes.includes(parsed.protocol)
  );
}

/** Links that should open in the system browser: web pages only, never `file:` or app schemes. */
export function isExternalLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
