import { Module } from "@nestjs/common";
import { HubModule } from "../hub/hub.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { RunLogModule } from "../run-log/run-log.module.js";
import { BudgetGuard } from "./budget-guard.js";
import { IdleWatchdog } from "./idle-watchdog.js";

/**
 * The guards that watch a run from the side: spending and idle time. (The ones that judge a
 * message are policies of the Hub's chain, wired in `HubModule`; every trip goes through the
 * `GuardEnforcer`, also from `HubModule`.) Nothing injects these two: they work by listening.
 */
@Module({
  imports: [HubModule, RealtimeModule, RunLogModule],
  providers: [BudgetGuard, IdleWatchdog],
})
export class GuardsModule {}
