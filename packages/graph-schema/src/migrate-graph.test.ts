import { describe, expect, it } from "vitest";
import { GraphMigrationError, migrateGraph } from "./migrate-graph.js";
import { validGraph } from "./test-support.js";

function catchMigrationError(input: unknown): GraphMigrationError {
  try {
    migrateGraph(input);
  } catch (error) {
    if (error instanceof GraphMigrationError) return error;
    throw error;
  }
  throw new Error("expected migrateGraph to throw");
}

describe("migrateGraph", () => {
  it("returns a v1 graph unchanged", () => {
    const graph = validGraph();
    expect(migrateGraph(graph)).toEqual(graph);
  });

  it("throws unsupported_schema_version for an unknown version", () => {
    expect(catchMigrationError({ ...validGraph(), schemaVersion: 99 }).code).toBe(
      "unsupported_schema_version",
    );
    expect(catchMigrationError({ ...validGraph(), schemaVersion: "1" }).code).toBe(
      "unsupported_schema_version",
    );
  });

  it("throws missing_schema_version when the version is absent", () => {
    expect(catchMigrationError({ name: "sem versão" }).code).toBe("missing_schema_version");
    expect(catchMigrationError(null).code).toBe("missing_schema_version");
  });

  it("keeps graphs saved with the read-only vault tool valid, unchanged and without a link flag", () => {
    const saved = validGraph();
    saved.nodes.push({
      id: "notas",
      type: "tool",
      position: { x: 0, y: 0 },
      name: "Notas",
      tool: { kind: "obsidian", vaultPath: "C:\\Notas", readOnly: true },
    });
    const migrated = migrateGraph(JSON.parse(JSON.stringify(saved)));
    expect(migrated).toEqual(saved);
    expect(migrated.links.every((entry) => entry.readOnly === undefined)).toBe(true);
  });
});
