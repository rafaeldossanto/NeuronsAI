import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { remoteOrigin } from "./remote-origin.js";

export const nativeCredentials = z
  .object({
    accessToken: z.string().regex(/^nsa_[A-Za-z0-9_-]{43}$/),
    refreshToken: z.string().regex(/^nsr_[A-Za-z0-9_-]{43}$/),
    accessExpiresAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      Date.parse(value.accessExpiresAt) > Date.now() &&
      Date.parse(value.accessExpiresAt) <= Date.parse(value.expiresAt),
  );
export type NativeCredentials = z.infer<typeof nativeCredentials>;
const opaque = () => randomBytes(32).toString("base64url");
const equal = (first: string, second: string) =>
  first.length === second.length && timingSafeEqual(Buffer.from(first), Buffer.from(second));

/** Main-process only. The system browser returns a PKCE-bound code, never session credentials. */
export class NativeLogin {
  private cancelPending?: () => void;
  constructor(
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 10 * 60_000,
  ) {}
  cancel(): void {
    this.cancelPending?.();
  }
  async begin(value: string): Promise<NativeCredentials> {
    const origin = remoteOrigin(value);
    if (this.cancelPending) throw new Error("Já existe uma entrada em andamento.");
    const state = opaque(),
      verifier = opaque();
    const controller = new AbortController();
    let abortMessage = "Entrada cancelada. Você pode tentar novamente.";
    let accept!: (code: string) => void, refuse!: (error: Error) => void;
    const returned = new Promise<string>((resolve, reject) => {
      accept = resolve;
      refuse = reject;
    });
    // Attach rejection immediately: cancellation may happen while the browser is opening.
    void returned.catch(() => {});
    const cancel = () => {
      controller.abort();
      refuse(new Error(abortMessage));
    };
    this.cancelPending = cancel;
    let redirectUri = "";
    const server = createServer(
      {
        maxHeaderSize: 8192,
        requestTimeout: 5_000,
        headersTimeout: 5_000,
        keepAliveTimeout: 1_000,
      },
      (request, response) => {
        const base = new URL(redirectUri);
        if (
          request.method !== "GET" ||
          request.headers.host !== base.host ||
          request.socket.remoteAddress !== "127.0.0.1"
        ) {
          response.writeHead(400).end();
          return;
        }
        const url = new URL(request.url ?? "/", base.origin);
        const receivedState = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        if (
          url.pathname !== base.pathname ||
          url.searchParams.getAll("state").length !== 1 ||
          !/^[A-Za-z0-9_-]{43}$/.test(receivedState) ||
          !equal(receivedState, state) ||
          url.searchParams.getAll("code").length > 1 ||
          url.searchParams.getAll("error").length > 1 ||
          (!/^[A-Za-z0-9_-]{43}$/.test(code) && !url.searchParams.has("error"))
        ) {
          response.writeHead(403).end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        response.end(
          "<!doctype html><html lang=pt-BR><meta charset=utf-8><title>NeuronsAI</title><h1>Volte ao NeuronsAI</h1><p>Você pode fechar esta aba e continuar no aplicativo.</p></html>",
        );
        server.close();
        if (url.searchParams.has("error"))
          refuse(new Error("A entrada não foi autorizada. Você pode tentar novamente."));
        else accept(code);
      },
    );
    const timer = setTimeout(() => {
      abortMessage = "A entrada expirou. Tente novamente.";
      controller.abort();
      refuse(new Error("A entrada expirou. Tente novamente."));
    }, this.timeoutMs);
    timer.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      if (controller.signal.aborted) await returned;
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/neurons/callback`;
      const authorizationUrl = new URL("/api/auth/desktop", origin);
      authorizationUrl.searchParams.set("redirectUri", redirectUri);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set(
        "codeChallenge",
        createHash("sha256").update(verifier).digest("base64url"),
      );
      await this.openBrowser(authorizationUrl.href);
      const code = await returned;
      const result = await this.transport(`${origin}/api/auth/desktop/exchange`, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      if (!result.ok)
        throw new Error("Não foi possível concluir a entrada. Inicie novamente pelo aplicativo.");
      const parsed = nativeCredentials.safeParse(await result.json());
      if (!parsed.success)
        throw new Error("O servidor retornou uma sessão inválida. Inicie novamente.");
      return parsed.data;
    } catch (error) {
      if (controller.signal.aborted) {
        // An aborted request can contain the exchanged code; return only the local status.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(abortMessage);
      }
      if (
        error instanceof Error &&
        /^(Entrada cancelada|A entrada|Não foi possível concluir|O servidor retornou)/.test(
          error.message,
        )
      )
        throw error;
      // Transport errors may contain the code/request body. Do not forward their cause through IPC.
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Não foi possível concluir a entrada. Confira o servidor e tente novamente.");
    } finally {
      clearTimeout(timer);
      this.cancelPending = undefined;
      server.close();
      server.closeAllConnections();
    }
  }
}
