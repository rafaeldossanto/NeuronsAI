import { describe, expect, it } from "vitest";
import { siteName } from "./index.js";

describe("site", () => {
  it("exposes the package name", () => {
    expect(siteName).toBe("@neurons/site");
  });
});
