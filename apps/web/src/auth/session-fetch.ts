let workspaceGeneration = 0;
const refreshes = new Set<Promise<boolean>>();

/** Discard old workspace responses and let a cookie rotation finish before switching organizations. */
export async function invalidateWorkspaceRequests(): Promise<void> {
  workspaceGeneration++;
  await Promise.allSettled([...refreshes]);
}

/** Credentials stay HttpOnly. Only the double-submit CSRF value is readable by the page. */
function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const secure = location.protocol === "https:";
  const name = `${secure ? "__Host-" : ""}neurons-csrf=`;
  const entries = document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name));
  if (entries.length !== 1) return "";
  const value = entries[0]!.slice(name.length);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}

/** One refresh at a time prevents simultaneous requests from replaying a rotating credential. */
export function sessionFetch(baseUrl: string, transport: typeof fetch = fetch): typeof fetch {
  let renewing: Promise<boolean> | undefined;
  const prepare = (request: Request) => {
    const headers = new Headers(request.headers);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      new URL(request.url).origin === location.origin
    ) {
      const csrf = csrfToken();
      if (csrf) headers.set("x-neurons-csrf", csrf);
    }
    return new Request(request, { headers });
  };
  return async (input, init) => {
    const generation = workspaceGeneration;
    const initialCsrf = csrfToken();
    const original = new Request(input, init);
    const retry = original.clone();
    const response = await transport(prepare(original));
    const current = () => {
      if (generation !== workspaceGeneration)
        throw new DOMException("O espaço de trabalho mudou.", "AbortError");
    };
    current();
    if (
      response.status !== 403 ||
      /\/auth\/(refresh|logout|google)(?:\/|$)/.test(new URL(original.url).pathname)
    )
      return response;
    const error = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: string } | null;
    current();
    if (error?.code !== "invalid_session") return response;
    // Another tab may have switched organizations before its broadcast reaches this tab.
    // Never replay the old operation with that organization's new cookies.
    if (!renewing && initialCsrf !== csrfToken()) {
      window.dispatchEvent(new Event("neurons:session-changed"));
      throw new DOMException("A sessão mudou.", "AbortError");
    }
    if (!csrfToken()) {
      window.dispatchEvent(new Event("neurons:session-ended"));
      return response;
    }
    if (!renewing) {
      const renewal = transport(prepare(new Request(`${baseUrl}/auth/refresh`, { method: "POST" })))
        .then((result) => result.status === 204)
        .catch(() => false)
        .finally(() => {
          refreshes.delete(renewal);
          renewing = undefined;
        });
      renewing = renewal;
      refreshes.add(renewal);
    }
    const renewed = await renewing;
    current();
    if (!renewed) {
      window.dispatchEvent(new Event("neurons:session-ended"));
      return response;
    }
    const result = await transport(prepare(retry));
    current();
    return result;
  };
}
