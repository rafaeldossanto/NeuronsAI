import { z } from "zod";

const runRef = z.object({ runId: z.uuid() });

/** `fromSeq` is the first seq the client still needs (last seen + 1); omit it for live events only. */
export const subscribeMessageSchema = runRef.extend({ fromSeq: z.int().nonnegative().optional() });
export const unsubscribeMessageSchema = runRef;

export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;

/**
 * `data` is not bounded here: the limit comes from the configuration and is checked with the rest
 * of the rules. Error messages built from this schema never repeat a value, because it may be a password.
 */
export const terminalInputMessageSchema = runRef.extend({
  agent: z.string().min(1).max(200),
  data: z.string().min(1),
});

export type TerminalInputMessage = z.infer<typeof terminalInputMessageSchema>;
