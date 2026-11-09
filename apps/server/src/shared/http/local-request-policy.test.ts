import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { testConfig } from "../config/testing/test-config.js";
import { allowsLocalRequest } from "./local-request-policy.js";

describe("local request origin and host", () => {
  it.each([
    ["127.0.0.1:3100", undefined, true],
    ["localhost:3100", "http://localhost:3100", true],
    ["[::1]:3100", "http://[::1]:3100", true],
    ["127.0.0.1:3100", "http://127.0.0.1:5173", false],
    ["127.0.0.1:3100", "null", false],
    ["127.0.0.1:3100", "https://evil.invalid", false],
    ["rebind.invalid:3100", "http://rebind.invalid:3100", false],
    ["localhost:3101", "http://localhost:3101", false],
    ["evil.invalid@localhost:3100", undefined, false],
  ] as const)("checks %s / %s", (host, origin, allowed) => {
    const request = new IncomingMessage(new Socket());
    request.headers.host = host;
    if (origin !== undefined) request.headers.origin = origin;
    expect(allowsLocalRequest(request, testConfig({ port: 3100 }))).toBe(allowed);
  });
});
