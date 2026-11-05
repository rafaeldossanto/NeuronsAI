export const RELEASES_URL = "https://github.com/rafaeldossanto/NeuronsAI/releases";
export const RELEASE_API = "https://api.github.com/repos/rafaeldossanto/NeuronsAI/releases/latest";
const REPOSITORY_PATH = "/rafaeldossanto/NeuronsAI";
const CACHE_KEY = "neuronsai:latest-release:v1";
const CACHE_MS = 15 * 60_000;
const ERROR_CACHE_MS = 5 * 60_000;

export type DesktopSystem = "windows" | "macos" | "linux" | "other";
export type DownloadId =
  | "windows-x64"
  | "macos-arm64-dmg"
  | "macos-x64-dmg"
  | "macos-arm64-zip"
  | "macos-x64-zip"
  | "linux-appimage"
  | "linux-deb";

export interface BrowserSystem {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** macOS architecture is deliberately not guessed from browser strings. */
export function detectSystem(browser: BrowserSystem): DesktopSystem {
  const text = `${browser.platform ?? ""} ${browser.userAgent ?? ""}`;
  if (/Android|iPhone|iPad|iPod/i.test(text)) return "other";
  if (/Mac/i.test(text) && (browser.maxTouchPoints ?? 0) > 1) return "other";
  if (/Windows|Win32|Win64/i.test(text)) return "windows";
  if (/Mac/i.test(text)) return "macos";
  if (/Linux|X11/i.test(text)) return "linux";
  return "other";
}

export interface PublicAsset {
  name: string;
  browser_download_url: string;
}
export interface PublicRelease {
  tag_name: string;
  html_url: string;
  draft: false;
  prerelease: false;
  assets: PublicAsset[];
}
export type ReleaseResult = { status: "ready"; release: PublicRelease } | { status: "soon" };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function githubUrl(value: unknown, pathname: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      decodeURIComponent(url.pathname) === pathname
    );
  } catch {
    return false;
  }
}

/** Revalidate even cached data; no URL from a response is inserted as HTML. */
export function parseRelease(value: unknown): PublicRelease | null {
  const release = record(value);
  const tag = release["tag_name"];
  if (
    typeof tag !== "string" ||
    !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) ||
    release["draft"] !== false ||
    release["prerelease"] !== false ||
    !githubUrl(release["html_url"], `${REPOSITORY_PATH}/releases/tag/${tag}`) ||
    !Array.isArray(release["assets"])
  )
    return null;
  const assets: PublicAsset[] = [];
  for (const value of release["assets"]) {
    const asset = record(value);
    const name = asset["name"];
    if (
      typeof name === "string" &&
      /^[A-Za-z0-9_.-]+$/.test(name) &&
      githubUrl(
        asset["browser_download_url"],
        `${REPOSITORY_PATH}/releases/download/${tag}/${name}`,
      )
    )
      assets.push({ name, browser_download_url: asset["browser_download_url"] });
  }
  return { tag_name: tag, html_url: release["html_url"], draft: false, prerelease: false, assets };
}

export function chooseDownloads(
  release: PublicRelease,
): Partial<Record<DownloadId | "checksums", PublicAsset>> {
  const version = release.tag_name.replace(/^v/, "").replaceAll(".", "\\.");
  const rules: Record<DownloadId, string> = {
    "windows-x64": "(?:win|windows)-x64\\.exe",
    "macos-arm64-dmg": "(?:mac|macos)-arm64\\.dmg",
    "macos-x64-dmg": "(?:mac|macos)-x64\\.dmg",
    "macos-arm64-zip": "(?:mac|macos)-arm64\\.zip",
    "macos-x64-zip": "(?:mac|macos)-x64\\.zip",
    "linux-appimage": "linux-x64\\.AppImage",
    "linux-deb": "linux-x64\\.deb",
  };
  const selected: Partial<Record<DownloadId | "checksums", PublicAsset>> = {};
  for (const [id, pattern] of Object.entries(rules)) {
    const name = new RegExp(`^NeuronsAI-${version}-${pattern}$`);
    const asset = release.assets.find((entry) => name.test(entry.name));
    if (asset) selected[id as DownloadId] = asset;
  }
  const sums = release.assets.find((entry) => entry.name === "SHA256SUMS.txt");
  if (sums) selected.checksums = sums;
  return selected;
}

type SessionCache = Pick<Storage, "getItem" | "setItem">;
interface LoadOptions {
  fetcher?: typeof fetch;
  storage?: SessionCache;
  now?: () => number;
}

/** One anonymous request, no retries; failures are cached too to avoid hammering the rate limit. */
export async function loadLatestRelease(options: LoadOptions = {}): Promise<ReleaseResult> {
  const now = options.now ?? Date.now;
  const storage = options.storage;
  try {
    const cached = record(JSON.parse(storage?.getItem(CACHE_KEY) ?? "null"));
    const expires = cached["expires"];
    if (typeof expires === "number" && expires > now() && expires <= now() + 60 * 60_000) {
      if (cached["body"] === null) return { status: "soon" };
      const release = parseRelease(cached["body"]);
      if (release) return { status: "ready", release };
    }
  } catch {
    /* Storage can be disabled or full; downloads must keep working. */
  }

  let release: PublicRelease | null = null;
  let ttl = ERROR_CACHE_MS;
  try {
    const response = await (options.fetcher ?? fetch)(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) release = parseRelease(await response.json());
    if (release) ttl = CACHE_MS;
    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      if (Number.isFinite(reset)) ttl = Math.min(60 * 60_000, Math.max(ttl, reset - now()));
    }
  } catch {
    /* Offline, timeout, malformed JSON and rate limits share the safe fallback. */
  }
  try {
    storage?.setItem(CACHE_KEY, JSON.stringify({ expires: now() + ttl, body: release }));
  } catch {
    /* No personal data is stored, and storage is optional. */
  }
  return release ? { status: "ready", release } : { status: "soon" };
}

export function sessionCache(): SessionCache | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
