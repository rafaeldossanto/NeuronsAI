CREATE INDEX "run_events_usage_run_id_idx" ON "run_events" USING btree ("run_id") WHERE "run_events"."type" = 'UsageRecorded';--> statement-breakpoint
CREATE INDEX "runs_graph_version_id_idx" ON "runs" USING btree ("graph_version_id");--> statement-breakpoint
CREATE INDEX "runs_started_at_idx" ON "runs" USING btree ("started_at" DESC NULLS LAST,"id" DESC NULLS LAST);