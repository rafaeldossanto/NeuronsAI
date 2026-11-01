import { describe, expect, it } from "vitest";
import { mcpNeuronsName } from "./index.js";

describe("mcp-neurons", () => {
  it("exposes the package name", () => {
    expect(mcpNeuronsName).toBe("@neurons/mcp-neurons");
  });
});
