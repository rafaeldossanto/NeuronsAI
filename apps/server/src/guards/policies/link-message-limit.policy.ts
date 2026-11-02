import { linkBetween } from "@neurons/graph-schema";
import { isExternalAddress } from "../../hub/addresses.js";
import {
  allow,
  deny,
  type MessagePolicy,
  type PolicyVerdict,
  type SendContext,
} from "../../hub/message-policy.js";
import type { MessageStore } from "../../hub/message-store.js";

/**
 * The `maxMessages` of an arrow: how many messages may start a conversation over it, in both
 * directions together. Replies are free: they close a question the limit already let through, and
 * refusing one would only leave its `ask` waiting for the timeout.
 */
export class LinkMessageLimitPolicy implements MessagePolicy {
  constructor(private readonly store: Pick<MessageStore, "countOnLink">) {}

  async evaluate({ runId, graph, from, to, kind }: SendContext): Promise<PolicyVerdict> {
    if (kind === "reply" || isExternalAddress(from) || isExternalAddress(to)) return allow();

    const link = linkBetween(graph, from, to);
    const limit = link?.maxMessages;
    if (!link || limit === undefined) return allow();

    const sent = await this.store.countOnLink(runId, from, to);
    if (sent < limit) return allow();

    const reason = `A ligação entre "${from}" e "${to}" chegou ao limite de ${limit} mensagens e a execução foi parada.`;
    return deny("link_message_limit", reason, {
      guard: "link_max_messages",
      scope: "run",
      reason,
      data: { linkId: link.id, from, to, limit },
    });
  }
}
