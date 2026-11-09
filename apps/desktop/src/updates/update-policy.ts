// Pure rules of the automatic update, free of Electron so they are tested without it.

export const RELEASES_URL = "https://github.com/rafaeldossanto/NeuronsAI/releases";

/**
 * Whether macOS builds are signed and notarized. Squirrel.Mac refuses to apply an update to an app
 * that is not signed, so until T23 the app only points the user to the download. Flip this when
 * the release workflow signs the macOS build.
 */
export const MAC_BUILD_SIGNED = false;

/** How this install can be updated: by itself, by the user downloading it, or not at all. */
export type UpdateMode =
  { kind: "auto" } | { kind: "manual"; reason: "mac" | "deb" } | { kind: "off" };

export interface UpdateEnvironment {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** Running from an AppImage (Linux). A `.deb` install is not one. */
  appImage: boolean;
  updatesOff: boolean;
}

export function updateMode(env: UpdateEnvironment): UpdateMode {
  if (env.updatesOff || !env.packaged) return { kind: "off" };
  switch (env.platform) {
    case "win32":
      return { kind: "auto" };
    case "darwin":
      return MAC_BUILD_SIGNED ? { kind: "auto" } : { kind: "manual", reason: "mac" };
    case "linux":
      return env.appImage ? { kind: "auto" } : { kind: "manual", reason: "deb" };
    default:
      return { kind: "off" };
  }
}

/** What the interface shows. `manual` carries the page where the new version can be downloaded. */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "manual"; version: string; url: string; reason: "mac" | "deb" };

export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A version that came over the network is only shown (and put in a link) if it looks like one. */
export function isSafeVersion(version: unknown): version is string {
  return typeof version === "string" && SAFE_VERSION.test(version);
}

/** Whether the local API reports a run still going (pending or running). */
export async function hasActiveRuns(
  origin: string,
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<boolean> {
  for (const status of ["running", "pending"]) {
    const response = await fetcher(`${origin}/api/runs?status=${status}&limit=1`);
    if (!response.ok)
      throw new Error(`Não foi possível listar as execuções (${String(response.status)}).`);
    const body = (await response.json()) as { items?: unknown[] };
    if ((body.items?.length ?? 0) > 0) return true;
  }
  return false;
}
