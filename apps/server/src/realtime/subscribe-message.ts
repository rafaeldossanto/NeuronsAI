import { z } from "zod";

const runRef = z.object({ runId: z.uuid() });

/** `fromSeq` is the first seq the client still needs (last seen + 1); omit it for live events only. */
export const subscribeMessageSchema = runRef.extend({ fromSeq: z.int().nonnegative().optional() });
export const unsubscribeMessageSchema = runRef;

export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;
