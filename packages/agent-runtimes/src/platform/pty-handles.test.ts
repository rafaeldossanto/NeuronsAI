import { EventEmitter } from "node:events";
import type { IPty } from "node-pty";
import { describe, expect, it } from "vitest";
import { guardPtyWrites, isBrokenPipe } from "./pty-handles.js";

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A pty shaped like node-pty on Windows (write side in `_agent.inSocket`) and on Unix (`_socket`). */
function fakePty() {
  const inSocket = new EventEmitter();
  const socket = new EventEmitter();
  const pty = { _agent: { inSocket }, _socket: socket } as unknown as IPty;
  return { pty, inSocket, socket };
}

describe("isBrokenPipe", () => {
  it("recognises a write after the child is gone, and nothing else", () => {
    expect(isBrokenPipe(errno("EPIPE"))).toBe(true);
    expect(isBrokenPipe(errno("ECONNRESET"))).toBe(true);
    expect(isBrokenPipe(errno("EACCES"))).toBe(false);
    expect(isBrokenPipe(new Error("x"))).toBe(false);
    expect(isBrokenPipe(undefined)).toBe(false);
  });
});

describe("guardPtyWrites", () => {
  it("swallows EPIPE and ECONNRESET on the write sockets (they used to be uncaught)", () => {
    const { pty, inSocket, socket } = fakePty();
    // Without a listener, an `error` event with no handler throws: what took the process down.
    expect(() => inSocket.emit("error", errno("EPIPE"))).toThrow();
    guardPtyWrites(pty);
    expect(() => inSocket.emit("error", errno("EPIPE"))).not.toThrow();
    expect(() => socket.emit("error", errno("ECONNRESET"))).not.toThrow();
  });

  it("leaves other errors to node-pty's own listener when there is one (EIO of a closed Unix terminal)", () => {
    const { pty, socket } = fakePty();
    socket.on("error", () => undefined); // what node-pty registers itself
    guardPtyWrites(pty);
    expect(() => socket.emit("error", errno("EIO"))).not.toThrow();
  });

  it("still surfaces any other error when nobody else handles it", () => {
    const { pty, inSocket } = fakePty();
    guardPtyWrites(pty);
    expect(() => inSocket.emit("error", errno("EACCES"))).toThrow("EACCES");
  });

  it("does nothing where node-pty has no such sockets", () => {
    expect(() => guardPtyWrites({} as unknown as IPty)).not.toThrow();
  });
});
