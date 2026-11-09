import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, session, shell, type Session } from "electron";
import { createHash } from "node:crypto";
import { DesktopAccountManager } from "./accounts/account-manager.js";
import { DesktopAccountStore } from "./accounts/account-store.js";
import { installAccountControls } from "./accounts/account-controls.js";
import { cookiePrefix } from "./accounts/remote-origin.js";
import { DesktopConfigError, loadDesktopConfig } from "./config.js";
import { installMenu } from "./shell/menu.js";
import { installWindowControls } from "./shell/window-controls.js";
import { desktopMasterKey } from "./security/master-key.js";
import { SECURE_WEB_PREFERENCES, lockDownSession, lockDownWindow } from "./security/security.js";
import { installUpdater } from "./updates/updater.js";
import { hasActiveRuns, updateMode } from "./updates/update-policy.js";
import {
  type RunningServer,
  serverConfigFor,
  startServer,
  webRoot,
  withTriggers,
} from "./server/server.js";
import { installSettingsControls } from "./settings/settings-controls.js";
import { DesktopSettingsStore } from "./settings/settings-store.js";
import {
  appliedFrom,
  startWithTriggersFallback,
  type AppliedTriggers,
} from "./settings/triggers-settings.js";
import { createShutdown } from "./lifecycle/shutdown.js";

const APP_NAME = "NeuronsAI";
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.resolve(APP_DIR, "..", "build", "icon.png");

app.setName(APP_NAME);

let server: RunningServer | undefined;
let window: BrowserWindow | undefined;
let accounts: DesktopAccountManager | undefined;
let stopping = false;

function fail(title: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(title, message);
  app.exit(1);
  throw error instanceof Error ? error : new Error(message);
}

function openWindow(
  origin: string,
  partition?: string,
): { window: BrowserWindow; loaded: Promise<void> } {
  const created = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    frame: false,
    transparent: true,
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    ...(process.platform !== "darwin" && { icon: ICON }),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(APP_DIR, "preload.cjs"),
      ...(partition && { partition }),
      ...(partition && { additionalArguments: ["--neurons-desktop-remote"] }),
    },
  });
  lockDownWindow(created, origin);
  created.setAutoHideMenuBar(true);
  created.setMenuBarVisibility(false);
  created.on("maximize", () => created.webContents.send("neurons:maximized", true));
  created.on("unmaximize", () => created.webContents.send("neurons:maximized", false));
  created.once("ready-to-show", () => {
    if (!process.argv.includes("--smoke-hidden")) created.show();
  });
  created.on("closed", () => {
    if (window === created) window = undefined;
  });
  return { window: created, loaded: created.loadURL(origin) };
}

async function boot(): Promise<void> {
  const desktop = loadDesktopConfig();
  const config = serverConfigFor(desktop);
  // Electron's own files (cache, local storage) go beside the data, not in a folder of their own.
  app.setPath("userData", path.join(config.dataDir, "electron"));

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  await app.whenReady();
  installMenu();
  // The triggers choice (webhook port) is the person's, saved in the app's profile; the server only
  // reads it when it starts. `NEURONS_HOOKS_PORT` in the environment, if set, decides instead.
  const settings = new DesktopSettingsStore(config.dataDir);
  const environmentHooks = config.hooks !== undefined;
  let applied: AppliedTriggers = appliedFrom(config.hooks, "environment");
  try {
    const ui = webRoot(app.isPackaged, process.resourcesPath, APP_DIR);
    const wanted = withTriggers(config, (await settings.load()).triggers);
    const started = await startWithTriggersFallback(wanted, !environmentHooks, async (candidate) =>
      startServer(await desktopMasterKey(candidate), ui),
    );
    server = started.server;
    applied = appliedFrom(
      started.problem ? undefined : wanted.hooks,
      environmentHooks ? "environment" : "app",
      started.problem,
    );
  } catch (error) {
    fail("Não foi possível iniciar o NeuronsAI", error);
  }
  const { origin } = server;
  let currentOrigin = origin;
  const remoteSessions = new Map<string, Session>();
  const partitionFor = (target: string) =>
    `neurons-remote-${createHash("sha256").update(target).digest("hex")}`;
  const remoteSession = (target: string) => {
    let selected = remoteSessions.get(target);
    if (!selected) {
      // No persist: prefix: account cookies are memory-only; the refresh credential lives in safeStorage.
      selected = session.fromPartition(partitionFor(target));
      lockDownSession(selected, target);
      // A remote server never gets to open a save dialog on this computer.
      selected.on("will-download", (event) => event.preventDefault());
      selected.cookies.on("changed", (_event, cookie) => {
        if (cookie.name === `${cookiePrefix(target)}refresh`) accounts?.cookiesChanged(target);
      });
      remoteSessions.set(target, selected);
    }
    return selected;
  };
  const show = async (target: string) => {
    if (target !== origin) remoteSession(target);
    const previous = window;
    const previousOrigin = currentOrigin;
    currentOrigin = target;
    const created = openWindow(target, target === origin ? undefined : partitionFor(target));
    window = created.window;
    try {
      await created.loaded;
      previous?.close();
    } catch {
      window = previous;
      currentOrigin = previousOrigin;
      created.window.destroy();
      throw new Error("Não foi possível abrir a interface do servidor.");
    }
  };
  installWindowControls(() => currentOrigin, origin);
  installSettingsControls({
    store: settings,
    applied: () => applied,
    localOrigin: origin,
    hasActiveRuns: () => hasActiveRuns(origin),
    relaunch: () => {
      app.relaunch();
      app.quit();
    },
  });
  lockDownSession(session.defaultSession, origin);
  accounts = new DesktopAccountManager({
    dataDir: config.dataDir,
    localOrigin: origin,
    store: new DesktopAccountStore(config.dataDir),
    cookies: (target) => remoteSession(target).cookies,
    show,
    openBrowser: (url) => shell.openExternal(url),
  });
  installAccountControls(
    accounts,
    origin,
    () => currentOrigin,
    () => window,
  );
  const updates = updateMode({
    platform: process.platform,
    packaged: app.isPackaged,
    appImage: Boolean(desktop.appImage),
    updatesOff: Boolean(desktop.updatesOff),
  });
  installUpdater(() => currentOrigin, updates, process.platform, origin);
  await show(origin);
  await accounts.initialize();

  app.on("activate", () => {
    if (!window)
      void show(
        accounts?.state().mode === "remote" ? (accounts.state().serverOrigin ?? origin) : origin,
      ).catch(() => accounts?.openLocal());
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Stopping the server ends every agent and its terminal tree and closes the database cleanly, so
// quitting waits for it instead of exiting at once. But it never waits for ever: each step has a
// time limit (the packaged smoke test gives the whole quit 20 s) and the process leaves whatever
// happened, so a hung close can not keep the app alive after the person asked to quit.
const ACCOUNTS_CLOSE_MS = 3_000;
const SERVER_CLOSE_MS = 12_000;
/** If `app.exit` itself does not end the process (something native holding it), this does. */
const HARD_EXIT_MS = 4_000;

/** Kinds of things still open in this process, counted (`TCPSocketWrap×3, Timeout×2`): never their contents. */
function activeResources(): string {
  const counts = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo())
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${kind}×${String(count)}`).join(", ");
}

app.on("before-quit", (event) => {
  if (stopping || !server) return;
  event.preventDefault();
  stopping = true;
  console.warn("[desktop] Encerramento: solicitado.");
  const running = server;
  server = undefined;
  void createShutdown({
    steps: [
      { name: "contas", run: () => accounts?.close(), timeoutMs: ACCOUNTS_CLOSE_MS },
      { name: "servidor embutido", run: () => running.close(), timeoutMs: SERVER_CLOSE_MS },
    ],
    exit: () => {
      console.warn("[desktop] Encerramento: etapas concluídas; saindo.");
      setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
      app.exit(0);
    },
    log: (line) => console.warn(`[desktop] ${line}`),
    diagnose: activeResources,
  }).run();
});

boot().catch((error: unknown) => {
  if (error instanceof DesktopConfigError) fail("Configuração inválida", error);
  const name = error instanceof Error ? error.name : "";
  fail(name === "ConfigError" ? "Configuração inválida" : "Erro ao iniciar o NeuronsAI", error);
});
