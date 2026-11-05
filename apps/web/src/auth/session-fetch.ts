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
    const original = new Request(input, init);
    const retry = original.clone();
    const response = await transport(prepare(original));
    if (
      response.status !== 403 ||
      /\/auth\/(refresh|logout|google)(?:\/|$)/.test(new URL(original.url).pathname)
    )
      return response;
    const error = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: string } | null;
    if (error?.code !== "invalid_session") return response;
    if (!csrfToken()) {
      window.dispatchEvent(new Event("neurons:session-ended"));
      return response;
    }
    renewing ??= transport(prepare(new Request(`${baseUrl}/auth/refresh`, { method: "POST" })))
      .then((result) => result.status === 204)
      .catch(() => false)
      .finally(() => {
        renewing = undefined;
      });
    if (!(await renewing)) {
      window.dispatchEvent(new Event("neurons:session-ended"));
      return response;
    }
    return transport(prepare(retry));
  };
}
