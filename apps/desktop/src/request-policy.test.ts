import { describe, expect, it } from "vitest";
import { isAllowedRequest, isExternalLink } from "./request-policy.js";

const origin = "http://127.0.0.1:41234";

describe("isAllowedRequest", () => {
  it("preserva TLS e rejeita credenciais embutidas ao carregar um servidor remoto", () => {
    expect(
      isAllowedRequest("wss://neurons.example.invalid/ws", "https://neurons.example.invalid"),
    ).toBe(true);
    expect(
      isAllowedRequest("http://neurons.example.invalid/api", "https://neurons.example.invalid"),
    ).toBe(false);
    expect(
      isAllowedRequest("ws://neurons.example.invalid/ws", "https://neurons.example.invalid"),
    ).toBe(false);
    expect(
      isAllowedRequest(
        "https://user:password@neurons.example.invalid/api",
        "https://neurons.example.invalid",
      ),
    ).toBe(false);
  });
  it.each([
    "http://127.0.0.1:41234/",
    "http://127.0.0.1:41234/api/graphs?limit=2",
    "ws://127.0.0.1:41234/ws",
    "data:image/png;base64,AAAA",
    "blob:http://127.0.0.1:41234/5b1c",
    "devtools://devtools/bundled/devtools_app.html",
  ])("allows %s", (url) => {
    expect(isAllowedRequest(url, origin)).toBe(true);
  });

  it.each([
    "https://example.com/",
    "http://127.0.0.1:3100/graphs",
    "http://localhost:41234/",
    "ws://127.0.0.1:9999/ws",
    "http://127.0.0.1.evil.com:41234/",
    "file:///C:/Windows/win.ini",
    "ftp://127.0.0.1:41234/",
    "not a url",
  ])("blocks %s", (url) => {
    expect(isAllowedRequest(url, origin)).toBe(false);
  });
});

describe("isExternalLink", () => {
  it("opens only web pages in the system browser", () => {
    expect(isExternalLink("https://example.com")).toBe(true);
    expect(isExternalLink("http://example.com")).toBe(true);
    expect(isExternalLink("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
    expect(isExternalLink("ms-msdt:/id")).toBe(false);
    expect(isExternalLink("lixo")).toBe(false);
  });
});
