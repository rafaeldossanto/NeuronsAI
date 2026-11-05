import { describe, expect, it, vi } from "vitest";
import {
  chooseDownloads,
  detectSystem,
  loadLatestRelease,
  parseRelease,
  RELEASE_API,
} from "./downloads.js";

const names = [
  "NeuronsAI-0.1.7-win-x64.exe",
  "NeuronsAI-0.1.7-mac-arm64.dmg",
  "NeuronsAI-0.1.7-mac-x64.dmg",
  "NeuronsAI-0.1.7-mac-arm64.zip",
  "NeuronsAI-0.1.7-mac-x64.zip",
  "NeuronsAI-0.1.7-linux-x64.AppImage",
  "NeuronsAI-0.1.7-linux-x64.deb",
  "SHA256SUMS.txt",
  "NeuronsAI-0.1.7-win-x64.exe.blockmap",
  "latest.yml",
  "NeuronsAI-0.1.6-win-x64.exe",
  "NeuronsAI-0.1.7-win-arm64.exe",
];
const release = {
  tag_name: "v0.1.7",
  html_url: "https://github.com/rafaeldossanto/NeuronsAI/releases/tag/v0.1.7",
  draft: false,
  prerelease: false,
  assets: names.map((name) => ({
    name,
    browser_download_url: `https://github.com/rafaeldossanto/NeuronsAI/releases/download/v0.1.7/${name}`,
  })),
};
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
function cache() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("detecção do sistema", () => {
  it.each([
    [{ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows"],
    [{ platform: "MacIntel", userAgent: "Macintosh; Intel Mac OS X" }, "macos"],
    [{ platform: "MacARM" }, "macos"],
    [{ platform: "Linux x86_64" }, "linux"],
    [{ platform: "Linux aarch64", userAgent: "Android 15" }, "other"],
    [{ platform: "MacIntel", maxTouchPoints: 5 }, "other"],
    [{ userAgent: "iPhone" }, "other"],
    [{}, "other"],
  ] as const)("reconhece %j como %s", (browser, expected) =>
    expect(detectSystem(browser)).toBe(expected),
  );
});

describe("seleção dos arquivos publicados", () => {
  it("oferece NSIS, os dois chips e formatos do macOS, AppImage, deb e checksums", () => {
    const selected = chooseDownloads(parseRelease(release)!);
    expect(Object.keys(selected)).toHaveLength(8);
    expect(selected["windows-x64"]?.name).toBe("NeuronsAI-0.1.7-win-x64.exe");
    expect(selected["macos-arm64-dmg"]?.name).toBe("NeuronsAI-0.1.7-mac-arm64.dmg");
    expect(selected["macos-x64-dmg"]?.name).toBe("NeuronsAI-0.1.7-mac-x64.dmg");
    expect(selected["macos-arm64-zip"]?.name).toBe("NeuronsAI-0.1.7-mac-arm64.zip");
    expect(selected["macos-x64-zip"]?.name).toBe("NeuronsAI-0.1.7-mac-x64.zip");
    expect(selected["linux-appimage"]?.name).toBe("NeuronsAI-0.1.7-linux-x64.AppImage");
    expect(selected["linux-deb"]?.name).toBe("NeuronsAI-0.1.7-linux-x64.deb");
    expect(selected.checksums?.name).toBe("SHA256SUMS.txt");
  });
  it("não inventa links para formatos ausentes e ignora URLs externas", () => {
    const safe = parseRelease({
      ...release,
      assets: [{ name: names[0], browser_download_url: "https://example.com/arquivo.exe" }],
    });
    expect(chooseDownloads(safe!)).toEqual({});
  });
  it.each([
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, html_url: "javascript:alert(1)" },
    { assets: [] },
    null,
  ])("recusa dados inválidos %j", (value) => {
    expect(parseRelease(value)).toBeNull();
  });
});

describe("API pública e cache da sessão", () => {
  it("consulta sem autenticação e reutiliza uma release da sessão", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(release));
    const storage = cache();
    const result = await loadLatestRelease({ fetcher, storage, now: () => 1000 });
    expect(result.status).toBe("ready");
    expect(await loadLatestRelease({ fetcher, storage, now: () => 2000 })).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      RELEASE_API,
      expect.objectContaining({
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
      }),
    );
  });
  it.each([404, 500, 403, 429])(
    "sem release, erro ou limite HTTP %i mantém o fallback e não repete a consulta",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ message: "indisponível" }, status, { "x-ratelimit-reset": "3600" }),
        );
      const storage = cache();
      expect(await loadLatestRelease({ fetcher, storage, now: () => 1000 })).toEqual({
        status: "soon",
      });
      expect(await loadLatestRelease({ fetcher, storage, now: () => 2000 })).toEqual({
        status: "soon",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("tolera erro de rede, JSON inválido e armazenamento bloqueado", async () => {
    const unavailable = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("sem espaço");
      },
    };
    expect(
      await loadLatestRelease({
        storage: unavailable,
        fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")),
      }),
    ).toEqual({ status: "soon" });
    expect(
      await loadLatestRelease({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("{inválido")),
      }),
    ).toEqual({ status: "soon" });
  });
  it("refaz a consulta após o vencimento do cache", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json(release));
    const storage = cache();
    await loadLatestRelease({ fetcher, storage, now: () => 1000 });
    expect((await loadLatestRelease({ fetcher, storage, now: () => 1_000_000 })).status).toBe(
      "ready",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
