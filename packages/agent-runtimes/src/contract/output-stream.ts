import type { AgentRuntime } from "./agent-runtime.js";
import type { Unsubscribe } from "./signal.js";

/**
 * Where a piece of live text came from: `text` is what the model writes freely (it never reaches
 * another agent, only the screen); `message` is the body of a `send_message`, `reply` or `ask` while
 * the model is still writing it.
 */
export type OutputChannel = "text" | "message";

/**
 * A piece of what an agent is writing right now. Live only, like the terminal output: it never
 * enters the run log (the log keeps the message that was finally sent) and nobody gets the pieces
 * they missed. `turnId` ties the pieces of one text (or one message) together.
 */
export interface OutputDelta {
  turnId: string;
  channel: OutputChannel;
  delta: string;
}

/**
 * A runtime that writes its answers token by token (the API runtime, the stream-json CLI). The
 * pieces are already grouped (see {@link OutputBatcher}): a listener gets a few frames per second,
 * never one per token.
 */
export interface StreamingAgentRuntime extends AgentRuntime {
  onOutputDelta(listener: (delta: OutputDelta) => void): Unsubscribe;
}

export const isStreamingRuntime = (runtime: AgentRuntime): runtime is StreamingAgentRuntime =>
  "onOutputDelta" in runtime;

export const DEFAULT_BATCH_INTERVAL_MS = 50;
export const DEFAULT_BATCH_MAX_CHARS = 400;

/**
 * Groups the pieces of one text so a listener gets about one per `intervalMs` (or per `maxChars`)
 * instead of one per token. A piece of another text or channel flushes the pending one first, so
 * order is kept. Call {@link OutputBatcher.flush} when a turn ends and
 * {@link OutputBatcher.dispose} when the runtime stops.
 */
export class OutputBatcher {
  private pending: OutputDelta | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly emit: (delta: OutputDelta) => void,
    private readonly options: { intervalMs?: number; maxChars?: number } = {},
  ) {}

  push(turnId: string, channel: OutputChannel, delta: string): void {
    if (!delta) return;
    const pending = this.pending;
    if (pending && (pending.turnId !== turnId || pending.channel !== channel)) this.flush();
    if (this.pending) this.pending.delta += delta;
    else this.pending = { turnId, channel, delta };
    if (this.pending.delta.length >= (this.options.maxChars ?? DEFAULT_BATCH_MAX_CHARS)) {
      this.flush();
    } else {
      this.timer ??= setTimeout(
        () => this.flush(),
        this.options.intervalMs ?? DEFAULT_BATCH_INTERVAL_MS,
      );
    }
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) this.emit(pending);
  }

  /** Drops what is pending: the session is over and nobody wants a late piece. */
  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}

/**
 * The text field of a tool call that holds a message to another agent, by tool name (with or
 * without the `mcp__neurons__` prefix the CLI adds). `undefined` for any other tool.
 */
export function messageFieldOf(tool: string): "text" | "question" | undefined {
  const name = tool.replace(/^mcp__neurons__/, "");
  if (name === "send_message" || name === "reply") return "text";
  if (name === "ask") return "question";
  return undefined;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  "/": "/",
  "\\": "\\",
  '"': '"',
};

/**
 * Reads the value of one string field of a JSON object that arrives in fragments (the arguments of
 * a tool call), handing back the decoded characters as soon as they are complete. Tolerant by
 * design: whatever it cannot make sense of yields nothing, never an exception. Only a top-level
 * field counts, and only its first occurrence.
 */
export class JsonStringFieldStream {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private unicode: string | undefined;
  private expectKey = false;
  private kind: "key" | "target" | "other" = "other";
  private key = "";
  private lastKey: string | undefined;
  private afterColon = false;
  private done = false;

  constructor(private readonly field: string) {}

  /** The decoded characters of the field that this fragment completes (possibly none). */
  push(fragment: string): string {
    let out = "";
    for (const ch of fragment) {
      if (this.done) break;
      if (this.inString) out += this.inStringChar(ch);
      else this.outsideChar(ch);
    }
    return out;
  }

  private inStringChar(ch: string): string {
    const capturing = this.kind === "target";
    if (this.unicode !== undefined) {
      this.unicode += ch;
      if (this.unicode.length < 4) return "";
      const code = parseInt(this.unicode, 16);
      this.unicode = undefined;
      return Number.isNaN(code) ? "" : this.take(String.fromCharCode(code), capturing);
    }
    if (this.escaped) {
      this.escaped = false;
      if (ch === "u") {
        this.unicode = "";
        return "";
      }
      return this.take(SIMPLE_ESCAPES[ch] ?? ch, capturing);
    }
    if (ch === "\\") {
      this.escaped = true;
      return "";
    }
    if (ch === '"') {
      this.inString = false;
      if (this.kind === "key") {
        this.lastKey = this.key;
        this.key = "";
      } else if (capturing) {
        this.done = true;
      }
      return "";
    }
    return this.take(ch, capturing);
  }

  private take(ch: string, capturing: boolean): string {
    if (capturing) return ch;
    if (this.kind === "key") this.key += ch;
    return "";
  }

  private outsideChar(ch: string): void {
    switch (ch) {
      case '"':
        this.inString = true;
        this.kind =
          this.depth === 1 && this.expectKey
            ? "key"
            : this.depth === 1 && this.afterColon && this.lastKey === this.field
              ? "target"
              : "other";
        this.expectKey = false;
        this.afterColon = false;
        break;
      case "{":
      case "[":
        this.depth++;
        this.expectKey = this.depth === 1 && ch === "{";
        this.afterColon = false;
        break;
      case "}":
      case "]":
        this.depth--;
        break;
      case ":":
        if (this.depth === 1) this.afterColon = true;
        break;
      case ",":
        if (this.depth === 1) {
          this.expectKey = true;
          this.afterColon = false;
          this.lastKey = undefined;
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Follows the tool calls a model writes and gives back the part that is a message to another agent
 * (`send_message`/`reply` text, `ask` question), call by call. One instance per model reply.
 */
export class MessageBodyStreams {
  private readonly streams = new Map<string, JsonStringFieldStream | null>();

  /** The new characters of the message body that this fragment of arguments carries. */
  push(callId: string, tool: string, fragment: string): string {
    let stream = this.streams.get(callId);
    if (stream === undefined) {
      const field = messageFieldOf(tool);
      stream = field ? new JsonStringFieldStream(field) : null;
      this.streams.set(callId, stream);
    }
    return stream ? stream.push(fragment) : "";
  }
}

export type { Unsubscribe };
