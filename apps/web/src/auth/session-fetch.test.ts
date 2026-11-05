import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionFetch } from "./session-fetch";

const base = `${location.origin}/api`;
const csrf = "x".repeat(43);
afterEach(() => {
  document.cookie = "neurons-csrf=; Max-Age=0; Path=/";
});
describe("renovação e CSRF do cliente", () => {
  it("anexa CSRF apenas em alterações para a mesma origem", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    const transport = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const fetcher = sessionFetch(base, transport);
    await fetcher(new Request(`${base}/graphs`, { method: "POST" }));
    await fetcher(new Request("https://other.invalid/graphs", { method: "POST" }));
    const first = transport.mock.calls[0]![0] as Request,
      second = transport.mock.calls[1]![0] as Request;
    expect(first.headers.get("x-neurons-csrf")).toBe(csrf);
    expect(second.headers.has("x-neurons-csrf")).toBe(false);
  });
  it("duas respostas com acesso expirado compartilham uma única renovação", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshes = 0,
      requests = 0;
    const transport: typeof fetch = async (input) => {
      const request = input as Request;
      if (request.url.endsWith("/auth/refresh")) {
        refreshes++;
        await barrier;
        return new Response(null, { status: 204 });
      }
      return ++requests <= 2
        ? Response.json({ code: "invalid_session" }, { status: 403 })
        : Response.json({ items: [] });
    };
    const fetcher = sessionFetch(base, transport);
    const first = fetcher(new Request(`${base}/graphs`)),
      second = fetcher(new Request(`${base}/runs`));
    await vi.waitFor(() => expect(refreshes).toBe(1));
    release();
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(refreshes).toBe(1);
  });
  it("não repete requisições recusadas por falta de permissão", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    const transport = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ code: "organization_access_denied" }, { status: 403 })),
    );
    await sessionFetch(base, transport)(new Request(`${base}/graphs`, { method: "POST" }));
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
