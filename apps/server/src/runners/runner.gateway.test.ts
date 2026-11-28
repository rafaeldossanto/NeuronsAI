import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { Logger } from "@nestjs/common";
import { CLOSE_TRY_AGAIN, CLOSE_UNAUTHORIZED } from "@neurons/runner-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { testConfig } from "../shared/config/testing/test-config.js";
import { RunnerGateway } from "./runner.gateway.js";
import type { RunnerRegistry } from "./runner-registry.js";
import type { RunnerTokens } from "./runner-tokens.service.js";

/** The part of a `ws` socket the gateway uses. */
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | undefined;
  send(text: string): void {
    this.sent.push(text);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
}

const secret = "nrn_token-que-nao-pode-vazar";

function connect(authenticate: RunnerTokens["authenticate"]) {
  const socket = new FakeSocket();
  const accept = vi.fn();
  const gateway = new RunnerGateway(
    testConfig({ profile: "hybrid" }),
    { authenticate, markSeen: vi.fn() } as unknown as RunnerTokens,
    { accept } as unknown as RunnerRegistry,
  );
  gateway.handleConnection(
    socket as unknown as WebSocket,
    {
      headers: { authorization: `Bearer ${secret}` },
    } as IncomingMessage,
  );
  return { socket, accept };
}

afterEach(() => vi.restoreAllMocks());

describe("RunnerGateway: conferência do token", () => {
  it("uma falha passageira do banco fecha sem frame reject e com código não final", async () => {
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { socket, accept } = connect(() => Promise.reject(new Error("banco ocupado")));

    await vi.waitFor(() => expect(socket.closed).toBeDefined());

    expect(socket.closed?.code).toBe(CLOSE_TRY_AGAIN);
    expect(socket.closed?.code).not.toBe(CLOSE_UNAUTHORIZED);
    expect(socket.sent).toEqual([]);
    expect(accept).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(secret);
  });

  it("um token desconhecido continua sendo recusado de vez, com reject", async () => {
    const { socket } = connect(() => Promise.resolve(undefined));

    await vi.waitFor(() => expect(socket.closed).toBeDefined());

    expect(socket.closed?.code).toBe(CLOSE_UNAUTHORIZED);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "reject", code: "unauthorized" });
  });
});
