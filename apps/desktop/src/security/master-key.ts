import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { AppConfig } from "@neurons/server";

/** Desktop key is encrypted by the OS. The browser never receives it. */
export async function desktopMasterKey(config: AppConfig): Promise<AppConfig> {
  if (config.masterKey) return config;
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    return config;
  const file = path.join(config.dataDir, "secrets-key.enc");
  await mkdir(config.dataDir, { recursive: true });
  let encrypted: Buffer;
  try {
    encrypted = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    encrypted = safeStorage.encryptString(randomBytes(32).toString("base64"));
    try {
      await writeFile(file, encrypted, { flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      encrypted = await readFile(file);
    }
  }
  const key = Buffer.from(safeStorage.decryptString(encrypted), "base64");
  if (key.length !== 32) throw new Error("A chave protegida deste aplicativo é inválida.");
  return { ...config, masterKey: key };
}
