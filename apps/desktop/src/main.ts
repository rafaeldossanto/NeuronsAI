import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, session, shell, type Session } from "electron";
import { createHash } from "node:crypto";
import { DesktopAccountManager } from "./account-manager.js";
import { DesktopAccountStore } from "./account-store.js";
import { installAccountControls } from "./account-controls.js";
import { cookiePrefix } from "./remote-origin.js";
import { DesktopConfigError, loadDesktopConfig } from "./config.js";
import { installMenu } from "./menu.js";
import { installWindowControls } from "./window-controls.js";
import { desktopMasterKey } from "./master-key.js";
import { SECURE_WEB_PREFERENCES, lockDownSession, lockDownWindow } from "./security.js";
import { installUpdater } from "./updater.js";
import { updateMode } from "./update-policy.js";
import { type RunningServer, serverConfigFor, startServer, webRoot } from "./server.js";

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
  try {
    server = await startServer(
      await desktopMasterKey(config),
      webRoot(app.isPackaged, process.resourcesPath, APP_DIR),
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
// quitting waits for it instead of exiting at once.
app.on("before-quit", (event) => {
  if (stopping || !server) return;
  event.preventDefault();
  stopping = true;
  const running = server;
  server = undefined;
  void (async () => {
    await accounts?.close();
    await running.close();
  })().finally(() => app.exit(0));
});

boot().catch((error: unknown) => {
  if (error instanceof DesktopConfigError) fail("Configuração inválida", error);
  const name = error instanceof Error ? error.name : "";
  fail(name === "ConfigError" ? "Configuração inválida" : "Erro ao iniciar o NeuronsAI", error);
});
