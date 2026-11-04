import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";
import {
  MAX_IMPORT_BYTES,
  memorySchema,
  type CreateMemory,
  type MemoryRecord,
} from "./memories.contract.js";

export class MemoryError extends DomainError {
  constructor(
    readonly kind: DomainErrorKind,
    code: string,
    message: string,
  ) {
    super(code, message);
  }
}

/** Used on imported attachment paths too; never extracts a ZIP or follows a caller's absolute path. */
export function importPath(value: string): string[] {
  const segments = value.replaceAll("\\", "/").split("/");
  if (
    !segments.length ||
    segments.some(
      (s) =>
        !s ||
        s.startsWith(".") ||
        /[<>:"|?*]/.test(s) ||
        Array.from(s).some((char) => char.charCodeAt(0) < 32) ||
        /[. ]$/.test(s) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s),
    )
  ) {
    throw new MemoryError(
      "invalid",
      "invalid_memory_path",
      "O arquivo tem um caminho inválido ou reservado.",
    );
  }
  return segments;
}

/** One manifest per memory, published last: a failed import never appears in the catalog. */
@Injectable()
export class MemoriesService {
  private readonly root: string;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root = path.join(config.dataDir, "memories");
  }

  async list(): Promise<MemoryRecord[]> {
    await mkdir(this.root, { recursive: true });
    const items: MemoryRecord[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue;
      try {
        items.push(await this.get(entry.name));
      } catch (error) {
        if (!(error instanceof MemoryError && error.kind === "not_found")) throw error;
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  async get(id: string): Promise<MemoryRecord> {
    if (!z.uuid().safeParse(id).success)
      throw new MemoryError("invalid", "invalid_memory_id", "Memória inválida.");
    try {
      return memorySchema.parse(
        JSON.parse(await readFile(path.join(this.root, id, "memory.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new MemoryError("not_found", "memory_not_found", "Memória não encontrada.");
      throw error;
    }
  }

  async resolve(id: string): Promise<string> {
    const memory = await this.get(id);
    if (memory.storage === "local") {
      if (this.config.profile !== "local")
        throw new MemoryError(
          "unavailable",
          "local_memory_unavailable",
          "Este cofre pertence ao runner local. Use o aplicativo nesse computador ou importe uma cópia para o servidor.",
        );
      return memory.vaultPath!;
    }
    return path.join(this.root, id, "vault");
  }

  async create(body: CreateMemory): Promise<MemoryRecord> {
    if (
      body.storage === "local" &&
      (this.config.profile !== "local" || !body.vaultPath || body.files?.length)
    ) {
      throw new MemoryError(
        "invalid",
        "invalid_local_memory",
        "Conecte o cofre no aplicativo do computador que contém a pasta. No servidor, importe ou crie uma memória.",
      );
    }
    if (body.storage === "server" && body.vaultPath)
      throw new MemoryError(
        "invalid",
        "invalid_server_memory",
        "Memórias do servidor não recebem um caminho local.",
      );
    let vaultPath: string | undefined;
    if (body.storage === "local") {
      if (!path.isAbsolute(body.vaultPath!))
        throw new MemoryError(
          "invalid",
          "invalid_local_path",
          "Selecione uma pasta com caminho absoluto.",
        );
      try {
        vaultPath = await realpath(body.vaultPath!);
        if (!(await stat(vaultPath)).isDirectory()) throw new Error();
      } catch {
        throw new MemoryError(
          "invalid",
          "vault_unavailable",
          "A pasta do cofre não está disponível neste computador.",
        );
      }
    }
    // Validate and bound the entire import before writing anything.
    let bytes = 0;
    const seen = new Set<string>();
    const files = (body.files ?? []).map((file) => {
      const segments = importPath(file.path);
      const normalized = segments.join("/").toLowerCase();
      if (seen.has(normalized))
        throw new MemoryError(
          "invalid",
          "duplicate_memory_file",
          "O cofre contém caminhos duplicados.",
        );
      seen.add(normalized);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))
        throw new MemoryError(
          "invalid",
          "invalid_memory_file",
          "O conteúdo de um arquivo é inválido.",
        );
      const content = Buffer.from(file.data, "base64");
      bytes += content.length;
      if (bytes > MAX_IMPORT_BYTES)
        throw new MemoryError(
          "invalid",
          "memory_import_too_large",
          "Importe no máximo 20 MB por vez.",
        );
      return { segments, content };
    });
    const id = randomUUID();
    const directory = path.join(this.root, id);
    const vault = path.join(directory, "vault");
    const memory: MemoryRecord = {
      id,
      name: body.name,
      storage: body.storage,
      fileCount: files.length,
      createdAt: new Date().toISOString(),
      ...(vaultPath && { vaultPath, runner: "Este computador" }),
    };
    await mkdir(vault, { recursive: true });
    try {
      for (const file of files) {
        const target = path.join(vault, ...file.segments);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, { flag: "wx" });
      }
      await writeFile(path.join(directory, "memory.json"), JSON.stringify(memory), { flag: "wx" });
      return memory;
    } catch (error) {
      // directory is constructed exclusively from the private root and our fresh UUID.
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
