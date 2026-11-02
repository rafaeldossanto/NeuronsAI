import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type VaultErrorCode = "PATH_FORBIDDEN" | "NOT_FOUND" | "FILE_TOO_LARGE";

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

const FORBIDDEN_DIRS = new Set([".obsidian", ".trash"]);
const NOTE_EXTENSION = ".md";

export function isForbiddenDir(name: string): boolean {
  return FORBIDDEN_DIRS.has(name.toLowerCase());
}

function forbidden(reason: string): VaultError {
  return new VaultError("PATH_FORBIDDEN", `Caminho recusado: ${reason}.`);
}

/** Rejections that need no filesystem access. Returns the path segments to join to the root. */
function lexicalSegments(requested: string): string[] {
  if (requested.trim() === "" || requested.includes("\0")) {
    throw forbidden("caminho vazio ou inválido");
  }
  const absolute =
    path.win32.isAbsolute(requested) ||
    path.posix.isAbsolute(requested) ||
    /^[a-zA-Z]:/.test(requested);
  if (absolute) throw forbidden("use um caminho relativo ao cofre");
  const segments = requested.split(/[\\/]+/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) throw forbidden("caminho vazio ou inválido");
  if (segments.includes("..")) throw forbidden("não é permitido sair do cofre");
  if (segments.some((segment) => segment.includes(":"))) throw forbidden("caractere inválido");
  if (segments.some(isForbiddenDir)) throw forbidden("pasta reservada do Obsidian");
  return segments;
}

/** Notes can be referenced without extension, as in wikilinks. */
function withNoteExtension(segments: string[]): string[] {
  const last = segments.at(-1) ?? "";
  return path.extname(last) === "" ? [...segments.slice(0, -1), last + NOTE_EXTENSION] : segments;
}

/**
 * Read-only access to the notes of one vault. Every requested path goes through
 * `resolveNote`, the single place that decides what may leave the vault directory.
 */
export class Vault {
  private constructor(
    readonly root: string,
    private readonly maxNoteBytes: number,
  ) {}

  static async open(vaultPath: string, maxNoteBytes: number): Promise<Vault> {
    const root = await realpath(vaultPath);
    if (!(await stat(root)).isDirectory()) throw new Error("O caminho do cofre não é uma pasta.");
    return new Vault(root, maxNoteBytes);
  }

  /** Vault-relative path (forward slashes) of an absolute path inside the vault. */
  relative(absolute: string): string {
    return path.relative(this.root, absolute).split(path.sep).join("/");
  }

  async resolveNote(requested: string): Promise<string> {
    const segments = withNoteExtension(lexicalSegments(requested));
    const real = await this.canonical(path.join(this.root, ...segments));
    this.assertReadable(real);
    if (!(await stat(real)).isFile()) throw new VaultError("NOT_FOUND", "Nota não encontrada.");
    return real;
  }

  async readNote(requested: string): Promise<string> {
    return this.readResolved(await this.resolveNote(requested));
  }

  async readResolved(file: string): Promise<string> {
    if ((await stat(file)).size > this.maxNoteBytes) {
      throw new VaultError(
        "FILE_TOO_LARGE",
        `A nota excede o limite de ${this.maxNoteBytes} bytes.`,
      );
    }
    return readFile(file, "utf8");
  }

  private async canonical(candidate: string): Promise<string> {
    try {
      return await realpath(candidate);
    } catch {
      throw new VaultError("NOT_FOUND", "Nota não encontrada.");
    }
  }

  /** Runs on the canonical path, so symlinks, letter case and 8.3 names cannot dodge it. */
  private assertReadable(real: string): void {
    const relative = path.relative(this.root, real);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw forbidden("fora do cofre");
    }
    if (relative.split(path.sep).some(isForbiddenDir)) {
      throw forbidden("pasta reservada do Obsidian");
    }
    if (path.extname(real).toLowerCase() !== NOTE_EXTENSION) {
      throw forbidden("só notas .md podem ser lidas");
    }
  }
}
