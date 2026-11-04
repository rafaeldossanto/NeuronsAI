import { shell, type BrowserWindow, type Session } from "electron";
import { isAllowedRequest, isExternalLink } from "./request-policy.js";

/** `webPreferences` of the only window: isolated, sandboxed, no Node, no preload. */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
} as const;

/** Blocks every request that is not to the app's server, and every permission prompt. */
export function lockDownSession(session: Session, serverOrigin: string): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, serverOrigin) });
  });
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

/** Keeps the window on the app: other addresses open in the system browser or not at all. */
export function lockDownWindow(window: BrowserWindow, serverOrigin: string): void {
  const { webContents } = window;
  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedRequest(url, serverOrigin) && new URL(url).origin === serverOrigin) return;
    event.preventDefault();
    if (isExternalLink(url)) void shell.openExternal(url);
  });
  webContents.on("will-attach-webview", (event) => event.preventDefault());
}
