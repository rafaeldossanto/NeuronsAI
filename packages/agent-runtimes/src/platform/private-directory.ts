import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A scratch directory only the current user can open, for files that carry a token. POSIX: mode
 * 0700 (what `mkdtemp` gives) and 0600 files. Windows: the inherited ACL is replaced by a single
 * entry for the current user (`icacls`), best effort.
 */
export class PrivateDirectory {
  private constructor(readonly path: string) {}

  static async create(prefix: string): Promise<PrivateDirectory> {
    const directory = new PrivateDirectory(await mkdtemp(path.join(os.tmpdir(), prefix)));
    if (process.platform === "win32") {
      await run(
        "icacls",
        [directory.path, "/inheritance:r", "/grant:r", `${os.userInfo().username}:(OI)(CI)F`],
        { windowsHide: true },
      ).catch(() => undefined); // %TEMP% is already per user; the ACL is an extra layer
    } else {
      await chmod(directory.path, 0o700);
    }
    return directory;
  }

  /** Writes a file readable only by the current user and returns its absolute path. */
  async write(name: string, content: string): Promise<string> {
    const file = path.join(this.path, name);
    await writeFile(file, content, { mode: 0o600 });
    return file;
  }

  remove(): Promise<void> {
    return rm(this.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
