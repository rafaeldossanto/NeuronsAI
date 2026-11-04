import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataDirLockedError, DirectoryLock } from "./directory-lock.js";

let root: string;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "neurons-lock-"));
  file = path.join(root, "db.lock");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

describe("DirectoryLock", () => {
  it("writes the owner's PID and removes the file on release", async () => {
    const lock = await DirectoryLock.acquire(root, file, { pid: 4321 });

    expect(await readFile(file, "utf8")).toBe("4321");
    await lock.release();
    expect(await exists(file)).toBe(false);
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("refuses while a live process holds it, naming the folder and the PID", async () => {
    await writeFile(file, "777");

    const attempt = DirectoryLock.acquire(root, file, { pid: 1, isAlive: (pid) => pid === 777 });

    await expect(attempt).rejects.toBeInstanceOf(DataDirLockedError);
    await expect(attempt).rejects.toThrow(/PID 777/);
    expect(await readFile(file, "utf8")).toBe("777");
  });

  it("takes over a lock left by a process that is gone", async () => {
    await writeFile(file, "777");

    const lock = await DirectoryLock.acquire(root, file, { pid: 1, isAlive: () => false });

    expect(await readFile(file, "utf8")).toBe("1");
    await lock.release();
  });

  it("takes over a file that does not hold a PID", async () => {
    await writeFile(file, "lixo");

    const lock = await DirectoryLock.acquire(root, file, { pid: 5, isAlive: () => true });

    expect(await readFile(file, "utf8")).toBe("5");
    await lock.release();
  });

  it("does not remove a lock that another process took after this one was released", async () => {
    const lock = await DirectoryLock.acquire(root, file, { pid: 5 });
    await writeFile(file, "9");

    await lock.release();

    expect(await readFile(file, "utf8")).toBe("9");
  });

  it("lets only one of two simultaneous attempts win", async () => {
    const alive = (pid: number) => pid === 11 || pid === 12;
    const results = await Promise.allSettled([
      DirectoryLock.acquire(root, file, { pid: 11, isAlive: alive }),
      DirectoryLock.acquire(root, file, { pid: 12, isAlive: alive }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
