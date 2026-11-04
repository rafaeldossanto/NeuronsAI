import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";

/** Another live process already holds the lock on the folder. */
export class DataDirLockedError extends Error {
  constructor(
    readonly directory: string,
    readonly lockFile: string,
    readonly pid: number | undefined,
  ) {
    super(
      `A pasta de dados já está em uso por outro processo do NeuronsAI${pid ? ` (PID ${pid})` : ""}: ${directory}. ` +
        `Feche o outro NeuronsAI antes de abrir este. Se tiver certeza de que nenhum está aberto, apague ${lockFile}.`,
    );
    this.name = "DataDirLockedError";
  }
}

export interface DirectoryLockOptions {
  /** Whether a process is alive; injectable for tests. */
  isAlive?: (pid: number) => boolean;
  /** This process's id; injectable for tests. */
  pid?: number;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else, so it is alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Locks this process holds: a file naming our own PID is stale only if it is not in here. */
const heldHere = new Set<string>();

const readOwner = async (file: string): Promise<number> =>
  Number.parseInt((await readFile(file, "utf8").catch(() => "")).trim(), 10);

/**
 * A lock for a folder that only one process may use at a time (PGlite corrupts the database when two
 * open the same folder). It is a file that holds the owner's PID, created atomically, so two
 * processes cannot both win. A file left by a process that is gone (crash, kill) is stale and is taken
 * over; one held by a live process makes {@link DirectoryLock.acquire} fail with
 * {@link DataDirLockedError}.
 */
export class DirectoryLock {
  private released = false;
  private readonly onExit = () => {
    try {
      rmSync(this.file, { force: true });
    } catch {
      // Nothing more to do at exit; the next start treats the file as stale.
    }
  };

  private constructor(
    readonly file: string,
    private readonly pid: number,
  ) {
    process.once("exit", this.onExit);
  }

  static async acquire(
    directory: string,
    file: string,
    options: DirectoryLockOptions = {},
  ): Promise<DirectoryLock> {
    const pid = options.pid ?? process.pid;
    const isAlive = options.isAlive ?? isProcessAlive;
    await mkdir(path.dirname(file), { recursive: true });
    if (heldHere.has(file)) throw new DataDirLockedError(directory, file, pid);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // Written whole under a private name and then hard-linked into place: `link` fails with
        // EEXIST if the lock exists and never exposes a half-written file to the loser.
        const staging = `${file}.${String(pid)}.${String(attempt)}.tmp`;
        await writeFile(staging, String(pid));
        try {
          await link(staging, file);
        } finally {
          await rm(staging, { force: true });
        }
        heldHere.add(file);
        return new DirectoryLock(file, pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const owner = await readOwner(file);
      if (Number.isInteger(owner) && owner > 0 && owner !== pid && isAlive(owner)) {
        throw new DataDirLockedError(directory, file, owner);
      }
      // Stale (or unreadable, or ours from a previous run): remove it and try again; if another
      // process takes it in between, the atomic create above decides who wins.
      await rm(file, { force: true });
    }
    throw new DataDirLockedError(directory, file, undefined);
  }

  /** Idempotent. Only removes the file while it still names this process. */
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    heldHere.delete(this.file);
    process.off("exit", this.onExit);
    if ((await readOwner(this.file)) === this.pid) await rm(this.file, { force: true });
  }
}
