import { describe, expect, it } from "vitest";
import { providersName } from "./index.js";

describe("providers", () => {
  it("exposes the package name", () => {
    expect(providersName).toBe("@neurons/providers");
  });
});
