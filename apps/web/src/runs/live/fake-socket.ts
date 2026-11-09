import type { SocketLike } from "./run-live-client";

/** A hand-made WebSocket: tests open it, push frames and read what the client sent. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: { event: string; data: Record<string, unknown> }[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static reset() {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error("nenhum socket criado");
    return socket;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as { event: string; data: Record<string, unknown> });
  }

  close() {
    this.closed = true;
  }

  /** Server side. */
  open() {
    this.onopen?.({});
  }
  push(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  drop() {
    this.onclose?.({});
  }
}
