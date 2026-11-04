import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, session } from "electron";
import { DesktopConfigError, loadDesktopConfig } from "./config.js";
import { installMenu } from "./menu.js";
import { installWindowControls } from "./window-controls.js";
import { desktopMasterKey } from "./master-key.js";
import { SECURE_WEB_PREFERENCES, lockDownSession, lockDownWindow } from "./security.js";
import { type RunningServer, serverConfigFor, startServer, webRoot } from "./server.js";

const APP_NAME = "NeuronsAI";
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.resolve(APP_DIR, "..", "build", "icon.png");

app.setName(APP_NAME);

let server: RunningServer | undefined;
let window: BrowserWindow | undefined;
let stopping = false;

function fail(title: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(title, message);
  app.exit(1);
  throw error instanceof Error ? error : new Error(message);
}

function openWindow(origin: string): BrowserWindow {
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
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload: path.join(APP_DIR, "preload.cjs") },
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
  void created.loadURL(origin);
  return created;
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
  installWindowControls(origin);
  lockDownSession(session.defaultSession, origin);
  window = openWindow(origin);

  app.on("activate", () => {
    if (!window) window = openWindow(origin);
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
  void running.close().finally(() => app.exit(0));
});

boot().catch((error: unknown) => {
  if (error instanceof DesktopConfigError) fail("Configuração inválida", error);
  const name = error instanceof Error ? error.name : "";
  fail(name === "ConfigError" ? "Configuração inválida" : "Erro ao iniciar o NeuronsAI", error);
});
