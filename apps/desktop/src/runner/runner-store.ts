import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import { z } from "zod";
import type { RunnerTokenMode } from "./runner-mode.js";

const storedRunner = z.object({
  serverOrigin: z.url(),
  mode: z.enum(["personal", "organization"]),
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  token: z.string().min(1).max(512),
});
export type StoredRunner = z.infer<typeof storedRunner>;

/**
 * The runner token of this computer, one per server origin and mode, encrypted by the operating
 * system (`safeStorage`, like the account store). It is read only by the main process and never
 * crosses IPC, the preload or the renderer.
 */
export class DesktopRunnerStore {
  constructor(
    private readonly dataDir: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  private available(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (this.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error("O armazenamento protegido do sistema não está disponível para o runner.");
  }

  private file(origin: string, mode: RunnerTokenMode): string {
    return path.join(
      this.dataDir,
      "runners",
      `${createHash("sha256").update(`${origin}\n${mode}`).digest("hex")}.enc`,
    );
  }

  async save(runner: StoredRunner): Promise<void> {
    this.available();
    const parsed = storedRunner.parse(runner),
      file = this.file(parsed.serverOrigin, parsed.mode);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(parsed)), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /** Nothing saved, or a file that no longer opens, is "no token": the manager then asks for a new one. */
  async load(origin: string, mode: RunnerTokenMode): Promise<StoredRunner | undefined> {
    this.available();
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.file(origin, mode));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const parsed = storedRunner.parse(JSON.parse(safeStorage.decryptString(encrypted)));
      if (parsed.serverOrigin !== origin || parsed.mode !== mode) throw new Error();
      return parsed;
    } catch {
      await this.clear(origin, mode);
      return undefined;
    }
  }

  async clear(origin: string, mode: RunnerTokenMode): Promise<void> {
    await rm(this.file(origin, mode), { force: true });
  }
}
