import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolSetupError } from "../core/errors.js";
import type { ToolNodeOf } from "../core/registry.js";
import { type SecretResolver, SecretNotFoundError, substituteSecrets } from "../core/secrets.js";
import { isProcessAlive, killProcessTree } from "./process-tree.js";

type McpConfig = ToolNodeOf<"mcp">["tool"];

/** The SDK waits 2 s after closing stdin before SIGTERM; the tree is forced down before that. */
const STDIO_GRACE_MS = 1_000;
const STDERR_TAIL_CHARS = 2_000;

export interface McpConnectionTransport {
  transport: Transport;
  /** Releases the process/connection, forcing the whole process tree down when needed. */
  shutdown(): Promise<void>;
  /** Last stderr output of a stdio server, for diagnostics. */
  stderrTail(): string;
}

async function resolveEnv(
  env: Record<string, string> | undefined,
  secrets: SecretResolver,
): Promise<Record<string, string> | undefined> {
  if (!env) return undefined;
  try {
    const entries = await Promise.all(
      Object.entries(env).map(async ([key, value]) => [
        key,
        (await substituteSecrets(value, secrets)).text,
      ]),
    );
    return Object.fromEntries(entries) as Record<string, string>;
  } catch (cause) {
    if (cause instanceof SecretNotFoundError) {
      throw new ToolSetupError("SECRET_NOT_FOUND", cause.message, { cause });
    }
    throw cause;
  }
}

async function stdioTransport(
  config: Extract<McpConfig, { transport: "stdio" }>,
  secrets: SecretResolver,
): Promise<McpConnectionTransport> {
  const env = await resolveEnv(config.env, secrets);
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    ...(env ? { env } : {}),
    stderr: "pipe",
  });
  let tail = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  return {
    transport,
    stderrTail: () => tail.trim(),
    async shutdown() {
      const pid = transport.pid;
      const closing = transport.close();
      const watchdog = setTimeout(() => {
        if (pid !== null) void killProcessTree(pid);
      }, STDIO_GRACE_MS);
      try {
        await closing;
      } finally {
        clearTimeout(watchdog);
      }
      if (pid !== null && isProcessAlive(pid)) await killProcessTree(pid);
    },
  };
}

function httpTransport(config: Extract<McpConfig, { transport: "http" }>): McpConnectionTransport {
  const transport = new StreamableHTTPClientTransport(new URL(config.url));
  return { transport, stderrTail: () => "", shutdown: () => transport.close() };
}

export function createTransport(
  config: McpConfig,
  secrets: SecretResolver,
): Promise<McpConnectionTransport> {
  return config.transport === "stdio"
    ? stdioTransport(config, secrets)
    : Promise.resolve(httpTransport(config));
}
