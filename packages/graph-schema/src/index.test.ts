import { describe, expect, it } from "vitest";
import { graphSchemaName } from "./index.js";

describe("graph-schema", () => {
  it("exposes the package name", () => {
    expect(graphSchemaName).toBe("@neurons/graph-schema");
  });
});
