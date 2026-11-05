import { describe, expect, it, vi } from "vitest";
import { hasActiveRuns, isSafeVersion, releaseUrl, updateMode } from "./update-policy.js";

const base = { platform: "win32", packaged: true, appImage: false, updatesOff: false } as const;

describe("updateMode", () => {
  it("updates itself on Windows and on the AppImage", () => {
    expect(updateMode(base)).toEqual({ kind: "auto" });
    expect(updateMode({ ...base, platform: "linux", appImage: true })).toEqual({ kind: "auto" });
  });

  it("only points to the download on unsigned macOS and on a .deb", () => {
    expect(updateMode({ ...base, platform: "darwin" })).toEqual({ kind: "manual", reason: "mac" });
    expect(updateMode({ ...base, platform: "linux" })).toEqual({ kind: "manual", reason: "deb" });
  });

  it("does nothing in development or when switched off", () => {
    expect(updateMode({ ...base, packaged: false })).toEqual({ kind: "off" });
    expect(updateMode({ ...base, updatesOff: true })).toEqual({ kind: "off" });
  });
});

describe("versions", () => {
  it("builds the release link and refuses odd versions", () => {
    expect(releaseUrl("0.1.0")).toBe(
      "https://github.com/rafaeldossanto/NeuronsAI/releases/tag/v0.1.0",
    );
    expect(isSafeVersion("0.1.0")).toBe(true);
    expect(isSafeVersion("1.2.3-beta.1")).toBe(true);
    expect(isSafeVersion("1.0.0/../x")).toBe(false);
    expect(isSafeVersion(undefined)).toBe(false);
  });
});

describe("hasActiveRuns", () => {
  const reply = (items: unknown[]) =>
    Promise.resolve(new Response(JSON.stringify({ items }), { status: 200 }));

  it("is true as soon as one status has a run", async () => {
    const fetcher = vi.fn((url: string) =>
      reply(url.includes("status=running") ? [{ id: "r" }] : []),
    );
    expect(await hasActiveRuns("http://127.0.0.1:1", fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("is false when neither status has one, and fails loudly on API errors", async () => {
    expect(await hasActiveRuns("http://x", () => reply([]))).toBe(false);
    await expect(
      hasActiveRuns("http://x", () => Promise.resolve(new Response("", { status: 500 }))),
    ).rejects.toThrow("500");
  });
});
