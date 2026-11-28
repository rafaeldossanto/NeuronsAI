import { z } from "zod";
import type { CookieJar } from "../accounts/account-manager.js";
import { cookiePrefix } from "../accounts/remote-origin.js";
import type { RunnerTokenMode } from "./runner-mode.js";
import type { StoredRunner } from "./runner-store.js";

export type RunnerIssueFailure = "signed-out" | "forbidden" | "conflict" | "failed";

/** Why the server did not give this computer a runner token. Carries no response content. */
export class RunnerIssueError extends Error {
  constructor(readonly kind: RunnerIssueFailure) {
    super(`runner token: ${kind}`);
    this.name = "RunnerIssueError";
  }
}

const issued = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  token: z.string().min(1).max(512),
});
export type IssuedRunner = z.infer<typeof issued>;

interface Options {
  cookies: (origin: string) => CookieJar;
  transport?: typeof fetch;
}

/**
 * The server calls that hand out and take back runner tokens, made with the signed-in session
 * (the same cookies, Origin and CSRF header the account manager sends). Main process only.
 */
export class RunnerApi {
  private readonly transport: typeof fetch;
  constructor(private readonly options: Options) {
    this.transport = options.transport ?? fetch;
  }

  private async headers(origin: string): Promise<Record<string, string>> {
    const prefix = cookiePrefix(origin);
    const all = await this.options.cookies(origin).get({ url: origin });
    const session = all.filter(
      (cookie) =>
        cookie.path === "/" &&
        ["access", "refresh", "csrf"].some((kind) => cookie.name === `${prefix}${kind}`),
    );
    const csrf = session.find((cookie) => cookie.name === `${prefix}csrf`)?.value;
    if (!csrf || !session.some((cookie) => cookie.name === `${prefix}access`))
      throw new RunnerIssueError("signed-out");
    return {
      Origin: origin,
      "x-neurons-csrf": csrf,
      Cookie: session.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    };
  }

  async issue(origin: string, mode: RunnerTokenMode, name: string): Promise<IssuedRunner> {
    const headers = await this.headers(origin);
    let response: Response;
    try {
      response = await this.transport(
        `${origin}${mode === "personal" ? "/api/runners/personal" : "/api/runners"}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
    } catch {
      throw new RunnerIssueError("failed");
    }
    if (response.status === 401) throw new RunnerIssueError("signed-out");
    if (response.status === 403) throw new RunnerIssueError("forbidden");
    if (response.status === 409) throw new RunnerIssueError("conflict");
    if (response.status !== 201) throw new RunnerIssueError("failed");
    const parsed = issued.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new RunnerIssueError("failed");
    return parsed.data;
  }

  /** Takes the token back. Throws on any failure: the caller decides it must not block. */
  async revoke(runner: StoredRunner): Promise<void> {
    const origin = runner.serverOrigin;
    const headers = await this.headers(origin);
    const target =
      runner.mode === "personal"
        ? `/api/runners/personal/${encodeURIComponent(runner.id)}`
        : `/api/runners/${encodeURIComponent(runner.name)}`;
    const response = await this.transport(`${origin}${target}`, {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers,
    });
    if (response.status !== 204) throw new Error("revoke failed");
  }
}
