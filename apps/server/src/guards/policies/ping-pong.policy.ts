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
 * Two agents answering each other forever. It trips on the message that would make `threshold`
 * in a row between the same two agents, in both directions, with nothing else in between: no
 * third agent, no `@human` and no `@trigger` (a person stepping in starts the count over). An
 * agent that calls `finish` ends the run, so it never gets here.
 */
export class PingPongPolicy implements MessagePolicy {
  constructor(
    private readonly store: Pick<MessageStore, "listRecent">,
    private readonly threshold: number,
  ) {}

  async evaluate({ runId, from, to }: SendContext): Promise<PolicyVerdict> {
    if (isExternalAddress(from) || isExternalAddress(to)) return allow();

    const before = this.threshold - 1;
    const recent = await this.store.listRecent(runId, before);
    if (recent.length < before) return allow();

    const samePair = (a: string, b: string) => (a === from && b === to) || (a === to && b === from);
    if (!recent.every((message) => samePair(message.from, message.to))) return allow();

    const directions = new Set([...recent, { from, to }].map((m) => `${m.from}>${m.to}`));
    if (directions.size < 2) return allow(); // one-way chatter is the link limit's business

    const reason = `"${from}" e "${to}" trocaram ${this.threshold} mensagens seguidas, sem mais ninguém e sem encerrar: a execução foi parada para não girar em círculo.`;
    return deny("ping_pong", reason, {
      guard: "ping_pong",
      scope: "run",
      reason,
      data: { agents: [from, to], messages: this.threshold },
    });
  }
}
