import type { GraphDefinition } from "@neurons/graph-schema";
import type { MessageKind } from "../database/schema/index.js";
import { MessageDeniedError } from "./hub.errors.js";
import type { MessageRecord } from "./message.js";

/** Everything a policy may look at to decide about one message. */
export interface SendContext {
  runId: string;
  graph: GraphDefinition;
  from: string;
  to: string;
  kind: MessageKind;
  body: string;
  /** The message being answered (only for `reply`). */
  replyTo?: MessageRecord;
}

export type PolicyVerdict = { allowed: true } | { allowed: false; code: string; reason: string };

export const allow = (): PolicyVerdict => ({ allowed: true });

/** @param code Stable machine-readable code (English). @param reason Text for the user (pt-BR). */
export const deny = (code: string, reason: string): PolicyVerdict => ({
  allowed: false,
  code,
  reason,
});

/** One rule of the chain a message goes through before it is stored. */
export interface MessagePolicy {
  evaluate(context: SendContext): PolicyVerdict | Promise<PolicyVerdict>;
}

/** Runs the policies in order; the first refusal stops the message. */
export class MessagePolicyChain {
  constructor(private readonly policies: readonly MessagePolicy[]) {}

  /** @throws MessageDeniedError carrying the refusing policy's code and reason. */
  async enforce(context: SendContext): Promise<void> {
    for (const policy of this.policies) {
      const verdict = await policy.evaluate(context);
      if (!verdict.allowed) throw new MessageDeniedError(verdict.code, verdict.reason);
    }
  }
}
