import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const PNG_PREFIX = "data:image/png;base64,";
const MAX_LENGTH = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parseAvatar(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_LENGTH ||
    !value.startsWith(PNG_PREFIX) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(PNG_PREFIX.length)) ||
    !Buffer.from(value.slice(PNG_PREFIX.length), "base64").subarray(0, 8).equals(PNG_SIGNATURE)
  )
    throw new Error("Imagem do perfil inválida.");
  return value;
}

/** Local profile image, independent of the embedded server's port on each launch. */
export class AvatarStore {
  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return path.join(this.dataDir, "profile-avatar.txt");
  }

  async load(): Promise<string | null> {
    try {
      return parseAvatar(await readFile(this.file, "utf8"));
    } catch {
      return null;
    }
  }

  async save(value: unknown): Promise<void> {
    const image = parseAvatar(value);
    await mkdir(this.dataDir, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, image, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
