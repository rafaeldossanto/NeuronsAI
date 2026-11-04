/**
 * What an application that embeds the server in its own process (the desktop app) needs, without
 * starting anything on import (`main.ts` is the standalone entry point and does).
 */
import "reflect-metadata";
export { createApp, type CreateAppOptions } from "./create-app.js";
export { ConfigError, loadConfig, type AppConfig } from "./shared/config/app-config.js";
export { DataDirLockedError } from "./database/directory-lock.js";
export { isLoopbackHost } from "./shared/config/listen-config.js";
