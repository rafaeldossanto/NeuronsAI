import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { HostEnvironment } from "./host-environment.js";

export class ClaudeBinaryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeBinaryNotFoundError";
  }
}

/** The file system questions the lookup asks; faked in tests. */
export interface FileProbe {
  exists(file: string): boolean;
  /** Names inside the directory; empty when it does not exist. */
  list(directory: string): string[];
}

export const realFiles: FileProbe = {
  exists: (file) => existsSync(file),
  list: (directory) => {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  },
};

export interface BinaryLookup {
  platform: NodeJS.Platform;
  host: HostEnvironment;
  homeDir: string;
  files?: FileProbe;
}

const compareVersions = (a: string, b: string): number => {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let i = 0; i < Math.max(left?.length ?? 0, right?.length ?? 0); i++) {
    const difference = (left?.[i] ?? 0) - (right?.[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/**
 * Finds the Claude Code executable. In order: the configured path (`NEURONS_CLAUDE_BIN`), `claude`
 * on the PATH, the places the installers use on this OS and, last, the CLI that ships inside the
 * Claude desktop app (newest version folder).
 *
 * @throws ClaudeBinaryNotFoundError, with a message for the user, when nothing is found.
 */
export function findClaudeBinary(configured: string | undefined, lookup: BinaryLookup): string {
  const files = lookup.files ?? realFiles;
  const windows = lookup.platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const executable = windows ? "claude.exe" : "claude";
  const variable = (name: string): string | undefined => {
    const key = Object.keys(lookup.host).find((k) =>
      windows ? k.toLowerCase() === name.toLowerCase() : k === name,
    );
    return key === undefined ? undefined : lookup.host[key];
  };

  if (configured) {
    if (files.exists(configured)) return configured;
    throw new ClaudeBinaryNotFoundError(
      `O Claude Code não foi encontrado no caminho configurado (NEURONS_CLAUDE_BIN): ${configured}`,
    );
  }

  const fromPath = (variable("PATH") ?? "")
    .split(windows ? ";" : ":")
    .filter(Boolean)
    .map((directory) => paths.join(directory, executable));
  const installed = [
    paths.join(lookup.homeDir, ".local", "bin", executable),
    paths.join(lookup.homeDir, ".claude", "local", executable),
    ...(windows ? [] : ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"]),
  ];

  const found = [...fromPath, ...installed].find((candidate) => files.exists(candidate));
  if (found) return found;

  const embedded = findDesktopEmbedded(lookup, files, paths, executable, variable);
  if (embedded) return embedded;

  throw new ClaudeBinaryNotFoundError(
    "O Claude Code não foi encontrado. Instale-o (https://claude.com/claude-code) ou informe o caminho em NEURONS_CLAUDE_BIN.",
  );
}

/** The CLI the Claude desktop app keeps per version: `<root>/<version>/<hash>/claude(.exe)`. */
function findDesktopEmbedded(
  lookup: BinaryLookup,
  files: FileProbe,
  paths: path.PlatformPath,
  executable: string,
  variable: (name: string) => string | undefined,
): string | undefined {
  const roots: string[] = [];
  if (lookup.platform === "win32") {
    const packages = paths.join(variable("LOCALAPPDATA") ?? "", "Packages");
    for (const name of files.list(packages).filter((entry) => entry.startsWith("Claude_"))) {
      roots.push(paths.join(packages, name, "LocalCache", "Roaming", "Claude", "claude-code"));
    }
    roots.push(paths.join(variable("APPDATA") ?? "", "Claude", "claude-code"));
    // Newer builds of the app keep their data (and the CLIs it downloads) outside the package:
    // `%LOCALAPPDATA%\Claude-Data\<package family>\claude-code`.
    const appData = paths.join(variable("LOCALAPPDATA") ?? "", "Claude-Data");
    for (const name of files.list(appData)) roots.push(paths.join(appData, name, "claude-code"));
  } else if (lookup.platform === "darwin") {
    roots.push(
      paths.join(lookup.homeDir, "Library", "Application Support", "Claude", "claude-code"),
    );
  }

  // The newest version wins, whichever folder it is in (an old app may leave stale ones behind).
  const installed = roots.flatMap((root) => files.list(root).map((version) => ({ root, version })));
  installed.sort((a, b) => compareVersions(b.version, a.version));
  for (const { root, version } of installed) {
    const versionDir = paths.join(root, version);
    const candidates = [
      paths.join(versionDir, executable),
      ...files.list(versionDir).map((hash) => paths.join(versionDir, hash, executable)),
    ];
    const found = candidates.find((candidate) => files.exists(candidate));
    if (found) return found;
  }
  return undefined;
}
