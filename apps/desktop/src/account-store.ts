import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import { z } from "zod";

const storedSession = z.object({
  serverOrigin: z.url(),
  refreshToken: z.string().regex(/^nsr_[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
});
export type DesktopAccountSession = z.infer<typeof storedSession>;

/** Main-process storage for the future remote desktop login. Never exposed through the preload. */
export class DesktopAccountStore {
  constructor(
    private readonly dataDir: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}
  private available(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (this.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error(
        "O armazenamento protegido do sistema não está disponível para guardar a sessão.",
      );
  }
  private file(origin: string): string {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      throw new Error("Use uma origem HTTPS ou um servidor local para a sessão.");
    return path.join(
      this.dataDir,
      "accounts",
      `${createHash("sha256").update(origin).digest("hex")}.enc`,
    );
  }
  async save(session: DesktopAccountSession): Promise<void> {
    this.available();
    const parsed = storedSession.parse(session),
      file = this.file(parsed.serverOrigin);
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
  async load(origin: string): Promise<DesktopAccountSession | undefined> {
    this.available();
    const file = this.file(origin);
    let encrypted: Buffer;
    try {
      encrypted = await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const parsed = storedSession.parse(JSON.parse(safeStorage.decryptString(encrypted)));
      if (parsed.serverOrigin !== origin) throw new Error();
      if (Date.parse(parsed.expiresAt) <= Date.now()) {
        await this.clear(origin);
        return undefined;
      }
      return parsed;
    } catch {
      throw new Error("Não foi possível abrir a sessão protegida. Entre novamente.");
    }
  }
  async clear(origin: string): Promise<void> {
    await rm(this.file(origin), { force: true });
  }
}
