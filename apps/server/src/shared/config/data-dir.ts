import path from "node:path";

/** What the default data folder depends on; injectable so every operating system can be tested. */
export interface HostInfo {
  platform: NodeJS.Platform;
  homedir: string;
}

const APP_FOLDER = "NeuronsAI";

/**
 * Where the app keeps its data when NEURONS_DATA_DIR is not set, following each system's convention:
 * - Windows: %APPDATA%\NeuronsAI
 * - macOS: ~/Library/Application Support/NeuronsAI
 * - others: $XDG_DATA_HOME/neuronsai, or ~/.local/share/neuronsai
 */
export function defaultDataDir(env: NodeJS.ProcessEnv, host: HostInfo): string {
  if (host.platform === "win32") {
    const appData = env.APPDATA || path.win32.join(host.homedir, "AppData", "Roaming");
    return path.win32.join(appData, APP_FOLDER);
  }
  if (host.platform === "darwin") {
    return path.posix.join(host.homedir, "Library", "Application Support", APP_FOLDER);
  }
  // The XDG spec says to ignore a relative XDG_DATA_HOME.
  const xdgDataHome = env.XDG_DATA_HOME;
  const base =
    xdgDataHome && path.posix.isAbsolute(xdgDataHome)
      ? xdgDataHome
      : path.posix.join(host.homedir, ".local", "share");
  return path.posix.join(base, APP_FOLDER.toLowerCase());
}

/** An explicit NEURONS_DATA_DIR wins; a relative one is resolved against the working directory. */
export function resolveDataDir(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
  host: HostInfo,
): string {
  if (explicit) return path.resolve(explicit);
  return defaultDataDir(env, host);
}
