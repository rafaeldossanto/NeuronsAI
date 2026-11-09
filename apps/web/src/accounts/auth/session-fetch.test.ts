import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateWorkspaceRequests, sessionFetch } from "./session-fetch";

const base = `${location.origin}/api`;
const csrf = "x".repeat(43);
afterEach(() => {
  document.cookie = "neurons-csrf=; Max-Age=0; Path=/";
});
describe("renovação e CSRF do cliente", () => {
  it("não inicia rotação se o corpo de um 403 antigo chega depois da troca", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    let release!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const errorBody = new Response();
    const read = vi.spyOn(errorBody, "json").mockReturnValue(body);
    const response = new Response(null, { status: 403 });
    vi.spyOn(response, "clone").mockReturnValue(errorBody);
    const transport = vi.fn<typeof fetch>(() => Promise.resolve(response));
    const pending = sessionFetch(
      base,
      transport,
    )(new Request(`${base}/graphs`, { method: "POST" }));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await invalidateWorkspaceRequests();
    release({ code: "invalid_session" });
    await rejected;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("aguarda a rotação em curso antes da troca e descarta o pedido do espaço anterior", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshing = false;
    const transport = vi.fn<typeof fetch>(async (input) => {
      if ((input as Request).url.endsWith("/auth/refresh")) {
        refreshing = true;
        await barrier;
        return new Response(null, { status: 204 });
      }
      return Response.json({ code: "invalid_session" }, { status: 403 });
    });
    const pending = sessionFetch(
      base,
      transport,
    )(new Request(`${base}/graphs`, { method: "POST" }));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(refreshing).toBe(true));
    let ready = false;
    const transition = invalidateWorkspaceRequests().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await transition;
    await rejected;
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("descarta uma requisição antiga sem renová-la nem repeti-la na nova organização", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    let release!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = sessionFetch(
      base,
      transport,
    )(new Request(`${base}/graphs`, { method: "POST", body: "{}" }));
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await invalidateWorkspaceRequests();
    release(Response.json({ code: "invalid_session" }, { status: 403 }));
    await assertion;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("não repete uma mutação com cookies trocados por outra aba", async () => {
    document.cookie = `neurons-csrf=${csrf}; Path=/`;
    const transport = vi.fn<typeof fetch>(() => {
      document.cookie = `neurons-csrf=${"y".repeat(43)}; Path=/`;
      return Promise.resolve(Response.json({ code: "invalid_session" }, { status: 403 }));
    });
    await expect(
      sessionFetch(base, transport)(new Request(`${base}/graphs`, { method: "POST" })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
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
