import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { isBlockedAddress } from "./address-policy.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** What a public server lets its tools reach. Absent policy = no restriction (the local profile). */
export interface OutboundPolicy {
  /** Ports a tool may call. A host in `allowHosts` is exempt. */
  allowedPorts: readonly number[];
  /**
   * Exceptions for destinations that would otherwise be refused: an exact host name, a `*.suffix`
   * wildcard or an IP literal. A listed host skips the address and port checks (not the scheme one).
   */
  allowHosts: readonly string[];
  /** Redirects followed before giving up. Defaults to {@link DEFAULT_MAX_REDIRECTS}. */
  maxRedirects?: number;
  /** DNS lookup, replaceable in tests. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443];
export const DEFAULT_MAX_REDIRECTS = 5;

/** The destination of a request is not allowed by the outbound policy. */
export class DestinationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestinationBlockedError";
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EMPTY_BODY_STATUSES = new Set([101, 204, 205, 304]);

function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function isHostAllowListed(allowHosts: readonly string[], host: string): boolean {
  const name = normalizeHost(host);
  return allowHosts.some((entry) => {
    const pattern = normalizeHost(entry);
    return pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : name === pattern;
  });
}

function effectivePort(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

function blocked(host: string, why: string): DestinationBlockedError {
  return new DestinationBlockedError(`O destino "${host}" ${why} e está bloqueado neste servidor.`);
}

function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

/**
 * The socket's DNS lookup: it resolves once, refuses the whole answer when any address is not
 * public, and hands the very same addresses to the connection. Validating and connecting on one
 * resolution is what defeats DNS rebinding (there is no second lookup for an attacker to change).
 */
function pinnedLookup(policy: OutboundPolicy, exempt: boolean): http.RequestOptions["lookup"] {
  const resolve = policy.resolve ?? defaultResolve;
  return ((
    hostname: string,
    options: { all?: boolean },
    callback: (error: Error | null, address: unknown, family?: number) => void,
  ) => {
    resolve(hostname).then(
      (records) => {
        if (records.length === 0) {
          callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
          return;
        }
        if (!exempt && records.some((record) => isBlockedAddress(record.address))) {
          callback(blocked(hostname, "resolve para um endereço interno"), "");
          return;
        }
        if (options.all) callback(null, records);
        else callback(null, records[0]?.address, records[0]?.family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), ""),
    );
  }) as http.RequestOptions["lookup"];
}

function checkDestination(policy: OutboundPolicy, url: URL): { exempt: boolean } {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw blocked(url.hostname, "usa um protocolo que não é http nem https");
  }
  const host = normalizeHost(url.hostname);
  const exempt = isHostAllowListed(policy.allowHosts, host);
  if (exempt) return { exempt };
  if (!policy.allowedPorts.includes(effectivePort(url))) {
    throw blocked(host, "usa uma porta que não está liberada");
  }
  // IP literals never reach the lookup, so they are judged here.
  if (net.isIP(host) !== 0 && isBlockedAddress(host)) {
    throw blocked(host, "é um endereço interno");
  }
  return { exempt };
}

function toBuffer(body: RequestInit["body"]): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new TypeError("Corpo de requisição não suportado.");
}

function decoded(res: http.IncomingMessage): Readable {
  switch (res.headers["content-encoding"]?.toLowerCase()) {
    case "gzip":
      return res.pipe(zlib.createGunzip());
    case "deflate":
      return res.pipe(zlib.createInflate());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

function sendOnce(
  policy: OutboundPolicy,
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  const { exempt } = checkDestination(policy, url);
  const outgoing: Record<string, string> = {};
  headers.forEach((value, name) => (outgoing[name] = value));
  outgoing["accept-encoding"] ??= "gzip, deflate, br";
  if (body) outgoing["content-length"] = String(body.byteLength);
  const lib = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const request = lib.request(
      {
        hostname: normalizeHost(url.hostname),
        port: effectivePort(url),
        path: `${url.pathname}${url.search}`,
        method,
        headers: outgoing,
        agent: false,
        lookup: pinnedLookup(policy, exempt),
        ...(signal ? { signal } : {}),
      },
      (res) => {
        try {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
              responseHeaders.append(name, item);
            }
          }
          if (res.headers["content-encoding"]) {
            responseHeaders.delete("content-encoding");
            responseHeaders.delete("content-length");
          }
          const status = res.statusCode ?? 502;
          if (status < 200 || status > 599) throw new Error("Invalid upstream HTTP status");
          const emptyBody = EMPTY_BODY_STATUSES.has(status) || method === "HEAD";
          if (emptyBody) res.resume();
          resolve(
            new Response(emptyBody ? null : Readable.toWeb(decoded(res)), {
              status,
              statusText: res.statusMessage ?? "",
              headers: responseHeaders,
            }),
          );
        } catch (error) {
          res.destroy();
          reject(error instanceof Error ? error : new Error("Invalid upstream HTTP response"));
        }
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

/**
 * A `fetch` for tools of a public server. It only speaks http/https on the allowed ports, refuses
 * destinations that resolve to internal addresses (see {@link isBlockedAddress}), connects to the
 * address it validated, and treats every redirect as a new request that goes through the same
 * checks. A redirect to another origin is followed without headers or body, so credentials meant
 * for one host never reach another.
 */
export function createGuardedFetch(policy: OutboundPolicy): FetchLike {
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  return async (input, init = {}) => {
    let url = new URL(input);
    let method = (init.method ?? "GET").toUpperCase();
    let headers = new Headers(init.headers);
    let body = toBuffer(init.body);

    for (let hop = 0; ; hop += 1) {
      const response = await sendOnce(policy, url, method, headers, body, init.signal);
      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
      void response.body?.cancel().catch(() => undefined);
      if (hop >= maxRedirects) {
        throw new DestinationBlockedError("A requisição foi redirecionada vezes demais.");
      }

      const next = new URL(location, url);
      if (next.origin !== url.origin) {
        if (body !== undefined && (response.status === 307 || response.status === 308)) {
          throw new DestinationBlockedError(
            "Redirecionamento para outra origem com corpo na requisição foi recusado.",
          );
        }
        headers = new Headers();
        body = undefined;
        if (method !== "GET" && method !== "HEAD" && response.status < 307) method = "GET";
      } else if (response.status === 303 || (response.status < 303 && method === "POST")) {
        method = method === "HEAD" ? "HEAD" : "GET";
        body = undefined;
        headers.delete("content-type");
      }
      url = next;
    }
  };
}
