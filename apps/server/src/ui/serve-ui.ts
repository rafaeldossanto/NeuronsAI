import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** The prefix under which the API lives when the server also serves the interface. */
export const API_PREFIX = "/api";
const UI_PREFIX = "/__ui__";

export interface UiOptions {
  /** Folder of the built interface (`apps/web/dist`), with an `index.html`. */
  root: string;
  /** Optional marketing page at /; every other client route still belongs to the editor. */
  landingRoot?: string;
}

/**
 * Restrictive policy for the interface: only this origin's scripts and styles, no frames, no
 * plugins, requests only to this server (HTTP and its WebSocket on the loopback address).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Maps a request URL when the server also serves the interface: `/api/...` is the API (prefix
 * removed, so no controller changes) and everything else belongs to the interface. Used as Fastify's
 * `rewriteUrl`, which runs before routing.
 */
export function rewriteForUi(url: string): string {
  if (url === API_PREFIX || url.startsWith(`${API_PREFIX}/`) || url.startsWith(`${API_PREFIX}?`)) {
    const rest = url.slice(API_PREFIX.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  if (url === "/ws" || url.startsWith("/ws?")) return url;
  return `${UI_PREFIX}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function regularFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function send(reply: FastifyReply, file: string, immutable: boolean): FastifyReply {
  const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return reply
    .header("content-type", type)
    .header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
    .header("content-security-policy", CONTENT_SECURITY_POLICY)
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .send(createReadStream(file));
}

/**
 * Serves the built interface as a single-page app: a file under `root` when it exists, `index.html`
 * for any other path without an extension (client-side routes), 404 for a missing asset. Paths that
 * try to leave `root` get 404. Register before the application starts.
 */
export function registerUiRoutes(fastify: FastifyInstance, options: UiOptions): void {
  const root = path.resolve(options.root);
  const index = path.join(root, "index.html");

  fastify.get(`${UI_PREFIX}/*`, async (request: FastifyRequest, reply: FastifyReply) => {
    const pathname = request.url.slice(UI_PREFIX.length).split("?")[0] ?? "/";
    if (pathname === "/" && options.landingRoot) {
      const landing = path.join(path.resolve(options.landingRoot), "index.html");
      if (await regularFile(landing)) {
        // The retained marketing page is self-contained, including its animation and fonts.
        return reply
          .header("content-type", MIME_TYPES[".html"]!)
          .header("cache-control", "no-cache")
          .header("x-content-type-options", "nosniff")
          .send(createReadStream(landing));
      }
    }
    let relative: string;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      return reply.code(404).send();
    }
    const file = path.resolve(root, `.${relative}`);
    const inside = path.relative(root, file);
    if (inside.startsWith("..") || path.isAbsolute(inside) || relative.includes("\0")) {
      return reply.code(404).send();
    }
    if (inside !== "" && (await regularFile(file))) {
      return send(reply, file, file.includes(`${path.sep}assets${path.sep}`));
    }
    if (path.extname(relative) !== "") return reply.code(404).send();
    if (await regularFile(index)) return send(reply, index, false);
    return reply.code(404).send();
  });
}
