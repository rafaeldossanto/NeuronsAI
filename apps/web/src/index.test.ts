import { describe, expect, it } from "vitest";
import { webName } from "./index.js";

describe("web", () => {
  it("exposes the package name", () => {
    expect(webName).toBe("@neurons/web");
  });
});
