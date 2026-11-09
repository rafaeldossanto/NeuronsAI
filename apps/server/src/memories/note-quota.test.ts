import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTools, InMemorySecretResolver } from "@neurons/tools";
import { MemoriesService } from "./memories.service.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { DEFAULT_QUOTAS } from "../shared/config/quota-config.js";

it("bounds note creation and growth across memories, permitting shrinking and recovery after failure", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "neurons-quota-regression-"));
  await resourceScope.run({ organizationId: randomUUID() }, async () => {
    const memories = new MemoriesService(
      testConfig({ dataDir, quotas: { ...DEFAULT_QUOTAS, memoryBytesPerOrganization: 1000 } }),
    );
    const a = await memories.create({ name: "A", storage: "server" });
    const b = await memories.create({ name: "B", storage: "server" });
    const sets = await Promise.all(
      [a, b].map(async (memory) =>
        createTools(
          {
            id: memory.id,
            type: "tool",
            name: "Vault",
            position: { x: 0, y: 0 },
            tool: {
              kind: "obsidian",
              vaultPath: await memories.resolve(memory.id),
              readOnly: false,
            },
          },
          { secrets: new InMemorySecretResolver(), checkNoteWrite: memories.checkNoteWrite },
        ),
      ),
    );
    const call = (index: number, name: string, input: unknown) =>
      memories.withNoteWrites(() =>
        sets[index]!.tools.find((tool) => tool.name === name)!.execute(input, {
          signal: AbortSignal.timeout(5000),
          secrets: new InMemorySecretResolver(),
        }),
      );
    const created = await Promise.all([
      call(0, "obsidian_create", { path: "one", content: "a".repeat(400) }),
      call(1, "obsidian_create", { path: "two", content: "b".repeat(400) }),
    ]);
    expect(created.filter((result) => result.ok)).toHaveLength(1);
    const index = created[0].ok ? 0 : 1,
      name = index === 0 ? "one" : "two",
      old = index === 0 ? "a" : "b";
    expect(
      (
        await call(index, "obsidian_edit", {
          path: name,
          previous: old.repeat(400),
          content: "x".repeat(1200),
        })
      ).ok,
    ).toBe(false);
    expect(
      await readFile(
        path.join(await memories.resolve(index === 0 ? a.id : b.id), name + ".md"),
        "utf8",
      ),
    ).toBe(old.repeat(400));
    expect(
      (
        await call(index, "obsidian_edit", {
          path: name,
          previous: old.repeat(400),
          content: "small",
        })
      ).ok,
    ).toBe(true);
    expect(
      (await call(1 - index, "obsidian_create", { path: "recovered", content: "fine" })).ok,
    ).toBe(true);
    await Promise.all(sets.map((set) => set.close()));
  });
});
