import type { MessagePolicy } from "../hub/message-policy.js";
import type { MessageStore } from "../hub/message-store.js";
import type { GuardLimits } from "../shared/config/guard-config.js";
import { LinkMessageLimitPolicy } from "./policies/link-message-limit.policy.js";
import { PingPongPolicy } from "./policies/ping-pong.policy.js";
import { RunMessageLimitPolicy } from "./policies/run-message-limit.policy.js";

/** The guards that look at a message before it is stored, in the order they apply (cheapest first). */
export function guardPolicies(
  store: MessageStore,
  limits: Pick<GuardLimits, "runMaxMessages" | "pingPongMessages">,
): MessagePolicy[] {
  return [
    new RunMessageLimitPolicy(store, limits.runMaxMessages),
    new LinkMessageLimitPolicy(store),
    new PingPongPolicy(store, limits.pingPongMessages),
  ];
}
