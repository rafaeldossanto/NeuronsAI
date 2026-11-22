import path from "node:path";
import { realFiles, type BinaryLookup } from "./claude-binary.js";

export class CodexBinaryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexBinaryNotFoundError";
  }
}

/** What to execute to get the Codex CLI: the program and the arguments that precede ours. */
export interface CodexCommand {
  command: string;
  args: string[];
}

const INSTALL_HINT =
  "O Codex não foi encontrado. Instale o app do Codex ou o Codex CLI (`npm i -g @openai/codex`), ou informe o caminho em NEURONS_CODEX_BIN.";

/**
 * Finds the Codex CLI. In order: the configured path (`NEURONS_CODEX_BIN`), `codex` on the PATH,
 * the places `npm i -g`, Homebrew and the standalone installer use on this OS and, last and only on
 * Windows, the copy the Codex desktop app leaves in `<CODEX_HOME>\.sandbox-bin\codex.exe`
 * (`CODEX_HOME` or `~\.codex`). The `codex.exe` inside the app package (`WindowsApps`) is not used:
 * Windows denies running it from another program. That `.sandbox-bin` folder is internal to the
 * app, so it comes last: the copy may be an alpha build or lag behind the npm CLI.
 *
 * @throws CodexBinaryNotFoundError, with a message for the user, when nothing is found.
 */
export function findCodexBinary(configured: string | undefined, lookup: BinaryLookup): string {
  const files = lookup.files ?? realFiles;
  const windows = lookup.platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const variable = (name: string): string | undefined => {
    const key = Object.keys(lookup.host).find((k) =>
      windows ? k.toLowerCase() === name.toLowerCase() : k === name,
    );
    return key === undefined ? undefined : lookup.host[key];
  };

  if (configured) {
    if (files.exists(configured)) return configured;
    throw new CodexBinaryNotFoundError(
      `O Codex CLI não foi encontrado no caminho configurado (NEURONS_CODEX_BIN): ${configured}`,
    );
  }

  // On Windows `npm i -g` leaves a `codex.cmd` shim next to the (absent) `codex`; the native
  // `codex.exe` is only there for the standalone installer.
  const names = windows ? ["codex.exe", "codex.cmd"] : ["codex"];
  const directories = [
    ...(variable("PATH") ?? "").split(windows ? ";" : ":").filter(Boolean),
    ...(windows
      ? [
          variable("APPDATA") ? paths.join(variable("APPDATA") ?? "", "npm") : "",
          paths.join(lookup.homeDir, ".local", "bin"),
        ]
      : [
          paths.join(lookup.homeDir, ".local", "bin"),
          paths.join(lookup.homeDir, ".npm-global", "bin"),
          "/usr/local/bin",
          "/opt/homebrew/bin",
        ]),
  ].filter(Boolean);

  for (const directory of directories) {
    for (const name of names) {
      const candidate = paths.join(directory, name);
      if (files.exists(candidate)) return candidate;
    }
  }

  if (windows) {
    // Only the exact `codex.exe`: the folder also holds `codex-command-runner-<version>.exe`.
    const home = variable("CODEX_HOME") || paths.join(lookup.homeDir, ".codex");
    const desktopCopy = paths.join(home, ".sandbox-bin", "codex.exe");
    if (files.exists(desktopCopy)) return desktopCopy;
  }
  throw new CodexBinaryNotFoundError(INSTALL_HINT);
}

/**
 * How to start what {@link findCodexBinary} found. A Windows `.cmd` shim cannot be spawned without a
 * shell (Node refuses it, and a shell would mangle the quotes of `-c` values), so the shim is
 * replaced by what it runs: Node on the `bin/codex.js` of the npm package, which starts the native
 * binary. Anything else is run as it is.
 *
 * @throws CodexBinaryNotFoundError when the shim's package or a Node to run it cannot be found.
 */
export function codexLaunchFor(binary: string, lookup: BinaryLookup): CodexCommand {
  const windows = lookup.platform === "win32";
  if (!windows || !/\.(cmd|bat)$/i.test(binary)) return { command: binary, args: [] };

  const files = lookup.files ?? realFiles;
  const paths = path.win32;
  const directory = paths.dirname(binary);
  const script = paths.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (!files.exists(script)) {
    throw new CodexBinaryNotFoundError(
      `O Codex CLI em ${binary} é um atalho do npm cujo pacote não foi encontrado. Reinstale com \`npm i -g @openai/codex\` ou informe o codex.exe em NEURONS_CODEX_BIN.`,
    );
  }

  const key = Object.keys(lookup.host).find((k) => k.toLowerCase() === "path");
  const pathDirectories = [directory, ...((key && lookup.host[key]) || "").split(";")];
  const node = pathDirectories
    .filter(Boolean)
    .map((entry) => paths.join(entry, "node.exe"))
    .find((candidate) => files.exists(candidate));
  if (!node) {
    throw new CodexBinaryNotFoundError(
      "O Node.js não foi encontrado para rodar o Codex CLI. Instale o Node.js ou informe o codex.exe em NEURONS_CODEX_BIN.",
    );
  }
  return { command: node, args: [script] };
}
