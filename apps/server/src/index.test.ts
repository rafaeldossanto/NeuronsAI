import { describe, expect, it } from "vitest";
import { serverName } from "./index.js";

describe("server", () => {
  it("exposes the package name", () => {
    expect(serverName).toBe("@neurons/server");
  });
});
