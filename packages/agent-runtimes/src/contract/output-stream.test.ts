import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JsonStringFieldStream,
  MessageBodyStreams,
  OutputBatcher,
  messageFieldOf,
  type OutputDelta,
} from "./output-stream.js";

const feed = (field: string, fragments: string[]) => {
  const stream = new JsonStringFieldStream(field);
  return fragments.map((fragment) => stream.push(fragment));
};

describe("JsonStringFieldStream", () => {
  it("hands back the characters of the field as each fragment completes them", () => {
    const pieces = feed("text", ['{"to":"b","te', 'xt":"Olá, ', 'mundo"', ',"x":1}']);
    expect(pieces).toEqual(["", "Olá, ", "mundo", ""]);
  });

  it("gives the same text whatever way the arguments are cut", () => {
    const json = JSON.stringify({ to: "b", text: 'linha 1\nlinha "2"\t\\ ✓ 😀 \u0001', n: 3 });
    const whole = new JsonStringFieldStream("text").push(json);
    expect(whole).toBe('linha 1\nlinha "2"\t\\ ✓ 😀 \u0001');
    for (let size = 1; size <= 7; size++) {
      const stream = new JsonStringFieldStream("text");
      let text = "";
      for (let i = 0; i < json.length; i += size) text += stream.push(json.slice(i, i + size));
      expect(text).toBe(whole);
    }
  });

  it("waits for a split escape and a split unicode escape", () => {
    expect(feed("text", ['{"text":"a\\', "nb\\u00", 'e9c"}'])).toEqual(["a", "\nb", "éc"]);
  });

  it("ignores the same name nested, in a list, or as another field's value", () => {
    const stream = new JsonStringFieldStream("text");
    const json =
      '{"meta":{"text":"fundo"},"list":["text"],"other":"text","text":"certo","text2":"x"}';
    expect(stream.push(json)).toBe("certo");
  });

  it("stops after the field and survives text that is not JSON", () => {
    const stream = new JsonStringFieldStream("text");
    expect(stream.push('{"text":"a"}{"text":"b"}')).toBe("a");
    expect(new JsonStringFieldStream("text").push('isto não é json {{{ ]]] \\ "')).toBe("");
    expect(new JsonStringFieldStream("text").push('{"text":"x\\u12')).toBe("x");
  });
});

describe("MessageBodyStreams", () => {
  it("follows each call on its own and ignores tools without a message", () => {
    const streams = new MessageBodyStreams();
    expect(streams.push("c1", "send_message", '{"to":"b","text":"o')).toBe("o");
    expect(streams.push("c2", "mcp__neurons__ask", '{"to":"c","question":"p?"}')).toBe("p?");
    expect(streams.push("c1", "send_message", 'i"}')).toBe("i");
    expect(streams.push("c3", "finish", '{"result":"pronto"}')).toBe("");
    expect(streams.push("c4", "reply", '{"messageId":"m","text":"ok"}')).toBe("ok");
    expect(messageFieldOf("use_tool")).toBeUndefined();
  });
});

describe("OutputBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rig = (maxChars?: number) => {
    const out: OutputDelta[] = [];
    const batcher = new OutputBatcher((delta) => out.push(delta), {
      intervalMs: 50,
      ...(maxChars && { maxChars }),
    });
    return { out, batcher };
  };

  it("groups the pieces that come within the interval into one", () => {
    const { out, batcher } = rig();
    batcher.push("t1", "text", "a");
    batcher.push("t1", "text", "b");
    vi.advanceTimersByTime(49);
    expect(out).toEqual([]);
    batcher.push("t1", "text", "c");
    vi.advanceTimersByTime(1);
    expect(out).toEqual([{ turnId: "t1", channel: "text", delta: "abc" }]);
    batcher.push("t1", "text", "d");
    vi.advanceTimersByTime(50);
    expect(out.map((delta) => delta.delta)).toEqual(["abc", "d"]);
  });

  it("flushes early when the pending text is long, and when another text starts", () => {
    const { out, batcher } = rig(5);
    batcher.push("t1", "text", "abcde");
    expect(out).toHaveLength(1);
    batcher.push("t1", "text", "ab");
    batcher.push("t1", "message", "xy");
    batcher.push("t2", "message", "z");
    batcher.flush();
    expect(out).toEqual([
      { turnId: "t1", channel: "text", delta: "abcde" },
      { turnId: "t1", channel: "text", delta: "ab" },
      { turnId: "t1", channel: "message", delta: "xy" },
      { turnId: "t2", channel: "message", delta: "z" },
    ]);
  });

  it("drops what is pending on dispose and leaves no timer behind", () => {
    const { out, batcher } = rig();
    batcher.push("t1", "text", "x");
    batcher.dispose();
    vi.advanceTimersByTime(1000);
    expect(out).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
