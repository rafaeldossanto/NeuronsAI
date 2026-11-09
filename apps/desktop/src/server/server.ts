import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { neuronsServerEntry } from "@neurons/mcp-neurons";
import { createApp, embeddedHooksConfig, loadConfig, type AppConfig } from "@neurons/server";
import type { DesktopConfig } from "../config.js";
import type { TriggersSettings } from "../settings/triggers-settings.js";

export interface RunningServer {
  /** `http://127.0.0.1:<port>`: the interface at `/`, the API under `/api`. */
  origin: string;
  /** Stops the agents and their terminals, flushes and closes the database. */
  close(): Promise<void>;
}

/**
 * The server's configuration for the app: whatever `NEURONS_*` says (data folder, limits, Claude
 * Code binary), except what the desktop app fixes: agents run in this process (profile `local`),
 * it listens on loopback only and it does everything (`all`). The port is chosen later, by the
 * operating system.
 */
export function serverConfigFor(desktop: DesktopConfig, env?: NodeJS.ProcessEnv): AppConfig {
  const config = env ? loadConfig(env) : loadConfig();
  const { auth, ...localConfig } = config;
  void auth; // The desktop's embedded server stays local/account-free even with cloud env settings.
  return {
    ...localConfig,
    mode: "all",
    profile: "local",
    host: "127.0.0.1",
    port: 0,
    // This process is Electron: the `neurons` MCP server (a Node script) must run it as plain Node.
    mcpServer: {
      command: process.execPath,
      args: [neuronsServerEntry()],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    },
    ...(desktop.claudeCommand && { claudeCommand: desktop.claudeCommand }),
  };
}

/**
 * Adds the webhook port the person chose in the settings screen. `NEURONS_HOOKS_PORT` in the
 * environment comes first (it is already in `config.hooks`), and with the triggers off nothing is
 * added: the embedded server then has no webhook listener at all.
 */
export function withTriggers(config: AppConfig, triggers: TriggersSettings): AppConfig {
  if (config.hooks || !triggers.enabled) return config;
  return { ...config, hooks: embeddedHooksConfig(triggers.port) };
}

/** Where the built interface is: in the app's resources when packaged, in `apps/web` otherwise. */
export function webRoot(packaged: boolean, resourcesPath: string, appDir: string): string {
  const root = packaged
    ? path.join(resourcesPath, "web")
    : path.resolve(appDir, "..", "..", "web", "dist");
  if (!existsSync(path.join(root, "index.html"))) {
    throw new Error(
      `A interface não foi encontrada em ${root}. Rode "pnpm --filter @neurons/web build".`,
    );
  }
  return root;
}

/** Starts the server on a free loopback port chosen by the operating system. */
export async function startServer(config: AppConfig, ui: string): Promise<RunningServer> {
  const app = await createApp(config, { ui: { root: ui } });
  try {
    // Port 0: the system picks a free one, with no window between "is it free?" and listening.
    await app.listen(0, config.host);
  } catch (error) {
    await app.close();
    throw error;
  }
  const address = app.getHttpServer().address() as AddressInfo;
  return {
    origin: `http://${config.host}:${String(address.port)}`,
    close: () => app.close(),
  };
}
