import type { z } from "zod";
import {
  runnerFrameSchema,
  serverFrameSchema,
  type RunnerFrame,
  type ServerFrame,
} from "./frames.js";
import { SUPPORTED_VERSIONS } from "./version.js";

export type DecodeFailureCode = "invalid_json" | "unsupported_version" | "invalid_frame";

export type DecodeResult<Frame> =
  { ok: true; frame: Frame } | { ok: false; code: DecodeFailureCode; message: string };

/** Bigger than any frame the protocol needs; guards the parser against a runaway peer. */
export const MAX_FRAME_CHARS = 8 * 1024 * 1024;

function decode<Frame>(raw: string, schema: z.ZodType<Frame>): DecodeResult<Frame> {
  if (raw.length > MAX_FRAME_CHARS) {
    return { ok: false, code: "invalid_frame", message: "Frame maior que o limite do protocolo." };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json", message: "O frame não é JSON." };
  }
  const version = (value as { v?: unknown } | null)?.v;
  if (typeof version !== "number" || !SUPPORTED_VERSIONS.includes(version)) {
    return {
      ok: false,
      code: "unsupported_version",
      message: `Versão de protocolo ${String(version)} não suportada (esta build fala ${SUPPORTED_VERSIONS.join(", ")}).`,
    };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Only where it is wrong, never what was sent: a frame may carry message bodies.
    const where = parsed.error.issues[0]?.path.join(".") ?? "";
    return {
      ok: false,
      code: "invalid_frame",
      message: `Frame inválido${where ? ` em ${where}` : ""}.`,
    };
  }
  return { ok: true, frame: parsed.data };
}

/** What the server reads: frames sent by a runner. */
export const decodeRunnerFrame = (raw: string): DecodeResult<RunnerFrame> =>
  decode(raw, runnerFrameSchema);

/** What a runner reads: frames sent by the server. */
export const decodeServerFrame = (raw: string): DecodeResult<ServerFrame> =>
  decode(raw, serverFrameSchema);

export const encodeFrame = (frame: RunnerFrame | ServerFrame): string => JSON.stringify(frame);
