import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";
import { DEFAULT_QUOTAS } from "../shared/config/quota-config.js";
import { QuotaExceededError } from "../shared/errors/quota-exceeded.error.js";
import { resourceScope } from "../accounts/resource-scope.js";
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
  /** The last queued creation of each organization (`""` is the local workspace). */
  private readonly queues = new Map<string, Promise<void>>();

  private readonly baseRoot: string;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.baseRoot = path.join(config.dataDir, "memories");
  }

  private get root(): string {
    const organizationId = resourceScope.current().organizationId;
    return organizationId === null
      ? this.baseRoot
      : path.join(this.baseRoot, "organizations", organizationId);
  }

  /**
   * An organization's limits on memories (how many, and the size of all their files together).
   * Called inside `exclusively`, so imports of one organization are checked one at a time. The local
   * workspace has no limits.
   * @throws QuotaExceededError
   */
  private async assertWithinQuotas(incomingBytes: number, creating = true): Promise<void> {
    if (resourceScope.current().organizationId === null) return;
    const limits = this.config.quotas ?? DEFAULT_QUOTAS;
    if (creating && limits.memoriesPerOrganization > 0) {
      const existing = (await this.list()).length;
      if (existing >= limits.memoriesPerOrganization) {
        throw new QuotaExceededError(
          "quota_memories",
          `Sua organização já tem ${limits.memoriesPerOrganization} memórias, o limite. Apague alguma antes de criar outra.`,
        );
      }
    }
    if (incomingBytes > 0 && limits.memoryBytesPerOrganization > 0) {
      const used = await directorySize(this.root);
      if (used + incomingBytes > limits.memoryBytesPerOrganization) {
        const megabytes = Math.floor(limits.memoryBytesPerOrganization / (1024 * 1024));
        throw new QuotaExceededError(
          "quota_memory_bytes",
          `As memórias da sua organização passariam do limite de ${megabytes} MB no total. Remova arquivos ou importe menos.`,
        );
      }
    }
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
      if (this.config.profile !== "local" || resourceScope.current().organizationId !== null)
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
      (this.config.profile !== "local" ||
        resourceScope.current().organizationId !== null ||
        !body.vaultPath ||
        body.files?.length)
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
    // Check and write as one step per organization, or two imports at once both pass the limit.
    return this.exclusively(async () => {
      await this.assertWithinQuotas(bytes);
      return this.write(body, files, vaultPath);
    });
  }

  checkNoteWrite = (deltaBytes: number): Promise<void> =>
    this.assertWithinQuotas(deltaBytes, false);

  withNoteWrites<T>(action: () => Promise<T>): Promise<T> {
    return this.exclusively(action);
  }

  /** Runs `action` after the ones already queued for the same organization (this server process). */
  private exclusively<T>(action: () => Promise<T>): Promise<T> {
    const key = resourceScope.current().organizationId ?? "";
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.then(action, action);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  private async write(
    body: CreateMemory,
    files: { segments: string[]; content: Buffer }[],
    vaultPath: string | undefined,
  ): Promise<MemoryRecord> {
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

/** Total size of the files under `directory` (0 when it does not exist yet). */
async function directorySize(directory: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await stat(target)).size;
  }
  return total;
}
