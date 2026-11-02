import {
  allow,
  deny,
  type MessagePolicy,
  type PolicyVerdict,
  type SendContext,
} from "../../hub/message-policy.js";
import type { MessageStore } from "../../hub/message-store.js";

/** A run may exchange at most `limit` messages (of any kind, `@human` and `@trigger` included). */
export class RunMessageLimitPolicy implements MessagePolicy {
  constructor(
    private readonly store: Pick<MessageStore, "countInRun">,
    private readonly limit: number,
  ) {}

  async evaluate({ runId }: SendContext): Promise<PolicyVerdict> {
    const sent = await this.store.countInRun(runId);
    if (sent < this.limit) return allow();

    const reason = `A execução chegou ao limite de ${this.limit} mensagens e foi parada.`;
    return deny("run_message_limit", reason, {
      guard: "run_max_messages",
      scope: "run",
      reason,
      data: { limit: this.limit },
    });
  }
}
