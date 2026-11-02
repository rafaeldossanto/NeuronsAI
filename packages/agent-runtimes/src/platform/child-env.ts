import type { HostEnvironment } from "./host-environment.js";

/** What every platform needs: where programs are, scratch space, locale, network and CA setup. */
const COMMON_VARIABLES = [
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  // Where the user's own Claude Code login lives, when they moved it.
  "CLAUDE_CONFIG_DIR",
];

const WINDOWS_VARIABLES = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "USERNAME",
  "USERDOMAIN",
  "OS",
  "PROCESSOR_ARCHITECTURE",
];

const POSIX_VARIABLES = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
];

/**
 * The only variables of the host that an agent's CLI inherits. Anything else (API keys, database
 * passwords, the Neurons master key, `CLAUDE_CODE_*` flags of an app that hosts us...) stays out.
 */
export const inheritedVariables = (platform: NodeJS.Platform): readonly string[] => [
  ...COMMON_VARIABLES,
  ...(platform === "win32" ? WINDOWS_VARIABLES : POSIX_VARIABLES),
];

export interface ChildEnvInput {
  host: HostEnvironment;
  platform: NodeJS.Platform;
  /** What the runtime itself needs the CLI to see (terminal type, MCP timeout...). */
  extra?: Readonly<Record<string, string>>;
}

/** Builds the environment of an agent's CLI explicitly: the system minimum plus `extra`. */
export function buildChildEnv({
  host,
  platform,
  extra = {},
}: ChildEnvInput): Record<string, string> {
  // Windows variable names are case-insensitive (`Path` vs `PATH`).
  const caseInsensitive = platform === "win32";
  const wanted = new Set(
    inheritedVariables(platform).map((name) => (caseInsensitive ? name.toLowerCase() : name)),
  );

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(host)) {
    if (value === undefined) continue;
    if (wanted.has(caseInsensitive ? name.toLowerCase() : name)) env[name] = value;
  }
  return { ...env, ...extra };
}
