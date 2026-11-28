import { z } from "zod";
import { idSchema } from "@neurons/graph-schema";
import { limitQuery } from "../api/common-schemas.js";
import { RUN_STATUSES } from "../database/schema/index.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ENCODED_IMAGE_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_END = Buffer.from("0000000049454e44ae426082", "hex");
const JPEG_SIGNATURE = Buffer.from("ffd8ff", "hex");

export const agentChatParams = z.object({ id: z.uuid(), agentId: idSchema });
export const agentChatQuery = z.object({
  limit: limitQuery(20, 50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const imageSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mediaType: z.enum(["image/png", "image/jpeg"]),
    base64: z.string().min(1).max(MAX_ENCODED_IMAGE_LENGTH),
  })
  .refine(isSupportedImage, {
    path: ["base64"],
    message: "Use um arquivo PNG ou JPEG válido de até 5 MiB.",
  });

export const sendChatTurnBody = z
  .object({
    body: z.string().trim().max(100_000),
    image: imageSchema.optional(),
  })
  .refine((input) => input.body.length > 0 || input.image !== undefined, {
    path: ["body"],
    message: "Escreva uma mensagem ou anexe uma imagem.",
  });

export const chatTurnStartedSchema = z.object({ runId: z.uuid() });

const chatTurnSchema = z
  .object({
    runId: z.uuid(),
    graphVersionId: z.uuid(),
    status: z.enum(RUN_STATUSES),
    input: z.string(),
    imageName: z.string().nullable(),
    replies: z.array(z.object({ id: z.uuid(), text: z.string() })),
    error: z.string().nullable(),
  })
  .meta({ id: "AgentChatTurn" });

export const chatTurnListSchema = z.object({
  items: z.array(chatTurnSchema),
  hasMore: z.boolean(),
});

export type AgentChatParams = z.infer<typeof agentChatParams>;
export type AgentChatQuery = z.infer<typeof agentChatQuery>;
export type SendChatTurnBody = z.infer<typeof sendChatTurnBody>;
export type AgentChatTurn = z.infer<typeof chatTurnSchema>;

function isSupportedImage({
  mediaType,
  base64,
}: {
  mediaType: "image/png" | "image/jpeg";
  base64: string;
}): boolean {
  if (base64.length > MAX_ENCODED_IMAGE_LENGTH || base64.length % 4 !== 0) return false;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== base64) return false;

  if (mediaType === "image/jpeg") return hasJpegFrame(bytes);

  return (
    bytes.length >= 57 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.subarray(-12).equals(PNG_END) &&
    hasPngImageData(bytes)
  );
}

function hasPngImageData(bytes: Buffer): boolean {
  // The first chunk is the 13-byte image header. Walk the bounded chunk structure before IEND.
  let position = 33;
  const end = bytes.length - PNG_END.length;
  while (position + 12 <= end) {
    const size = bytes.readUInt32BE(position);
    const next = position + size + 12;
    if (next > end) return false;
    if (size > 0 && bytes.toString("ascii", position + 4, position + 8) === "IDAT") return true;
    position = next;
  }
  return false;
}

function hasJpegFrame(bytes: Buffer): boolean {
  if (
    bytes.length < 20 ||
    !bytes.subarray(0, 3).equals(JPEG_SIGNATURE) ||
    bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
  )
    return false;

  const end = bytes.length - 2;
  let position = 2;
  let hasFrame = false;
  while (position + 4 <= end && bytes[position] === 0xff) {
    // Repeated FF bytes are legal padding before a marker.
    while (bytes[position + 1] === 0xff) position++;
    if (position + 4 > end) return false;
    const marker = bytes[position + 1]!;
    const size = bytes.readUInt16BE(position + 2);
    const next = position + 2 + size;
    if (size < 2 || next > end) return false;
    if (marker === 0xda) return hasFrame && size >= 6 && next < end;
    // Start-of-frame markers describe the dimensions (including progressive JPEGs).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      hasFrame =
        size >= 8 && bytes.readUInt16BE(position + 5) > 0 && bytes.readUInt16BE(position + 7) > 0;
    }
    position = next;
  }
  return false;
}
