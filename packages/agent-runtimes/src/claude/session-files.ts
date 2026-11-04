import { BRIDGE_ROUTES, MCP_SERVER_NAME } from "@neurons/mcp-neurons";
import { PrivateDirectory } from "../platform/private-directory.js";

/** How to start the `neurons` MCP server (a Node script): the executable and its arguments. */
export interface McpServerCommand {
  command: string;
  args: string[];
  /** Extra environment for the MCP server (for example `ELECTRON_RUN_AS_NODE` when `command` is Electron). */
  env?: Record<string, string>;
}

export interface SessionFilesInput {
  bridgeUrl: string;
  bridgeToken: string;
  mcpServer: McpServerCommand;
  askTimeoutMs: number;
  briefing: string;
  /** Hooks exist only for the PTY mode. */
  withHooks: boolean;
}

/** Margin over the `ask` timeout so the Hub's own timeout answer arrives before the CLI gives up. */
export const MCP_TOOL_TIMEOUT_MARGIN_MS = 30_000;

const HOOK_REQUEST_TIMEOUT_SEC = 5;

/**
 * The temporary files one session passes to the CLI (`--settings`, `--mcp-config`, the briefing),
 * all inside a directory only the current user can open and removed with the session. Nothing is
 * written to the user's own Claude Code folders.
 */
export class SessionFiles {
  private constructor(
    private readonly directory: PrivateDirectory,
    readonly mcpConfigFile: string,
    readonly briefingFile: string,
    readonly settingsFile: string | undefined,
  ) {}

  static async create(input: SessionFilesInput): Promise<SessionFiles> {
    const directory = await PrivateDirectory.create("neurons-agent-");
    try {
      return new SessionFiles(
        directory,
        await directory.write("mcp-config.json", JSON.stringify(mcpConfig(input), null, 2)),
        await directory.write("briefing.md", input.briefing),
        input.withHooks
          ? await directory.write("settings.json", JSON.stringify(settings(input), null, 2))
          : undefined,
      );
    } catch (error) {
      await directory.remove();
      throw error;
    }
  }

  /** Where the files live; for diagnostics and tests. */
  get directoryPath(): string {
    return this.directory.path;
  }

  dispose(): Promise<void> {
    return this.directory.remove();
  }
}

/** The MCP server gets the bridge address and token through its own `env` entry: its "config". */
function mcpConfig(input: SessionFilesInput): unknown {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: input.mcpServer.command,
        args: input.mcpServer.args,
        env: {
          ...input.mcpServer.env,
          NEURONS_BRIDGE_URL: input.bridgeUrl,
          NEURONS_BRIDGE_TOKEN: input.bridgeToken,
          NEURONS_ASK_TIMEOUT_MS: String(input.askTimeoutMs),
        },
        // Per-call limit of this server; without it an `ask` could be cut before the Hub's timeout.
        timeout: input.askTimeoutMs + MCP_TOOL_TIMEOUT_MARGIN_MS,
      },
    },
  };
}

/** Claude Code HTTP hooks: the CLI itself posts each event to the bridge. */
function settings(input: SessionFilesInput): unknown {
  const hook = (route: string) => [
    {
      hooks: [
        {
          type: "http",
          url: `${input.bridgeUrl}${route}`,
          headers: { Authorization: `Bearer ${input.bridgeToken}` },
          timeout: HOOK_REQUEST_TIMEOUT_SEC,
        },
      ],
    },
  ];
  return {
    hooks: {
      UserPromptSubmit: hook(BRIDGE_ROUTES.hooks.userPromptSubmit),
      Stop: hook(BRIDGE_ROUTES.hooks.stop),
    },
  };
}
