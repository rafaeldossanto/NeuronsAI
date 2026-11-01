import { Injectable } from "@nestjs/common";
import { peersOf } from "@neurons/graph-schema";
import { isExternalAddress } from "./addresses.js";
import {
  allow,
  deny,
  type MessagePolicy,
  type PolicyVerdict,
  type SendContext,
} from "./message-policy.js";

/**
 * The arrows of the graph. A message goes through when
 *  - the sender is `@human` or `@trigger`, or
 *  - it is a reply to whoever wrote the message being answered, or
 *  - the recipient is one the sender may start a conversation with (`canMessage`).
 */
@Injectable()
export class PermissionPolicy implements MessagePolicy {
  evaluate({ graph, from, to, kind, replyTo }: SendContext): PolicyVerdict {
    if (isExternalAddress(from)) return allow();

    if (kind === "reply") {
      const answersWhoWroteToSender = replyTo?.to === from && replyTo.from === to;
      return answersWhoWroteToSender
        ? allow()
        : deny(
            "reply_not_allowed",
            `"${from}" só pode responder a quem escreveu a mensagem respondida.`,
          );
    }

    const allowed = peersOf(graph, from).canMessage.some((peer) => peer.name === to);
    return allowed
      ? allow()
      : deny(
          "message_not_permitted",
          `"${from}" não tem uma seta para iniciar conversa com "${to}".`,
        );
  }
}
