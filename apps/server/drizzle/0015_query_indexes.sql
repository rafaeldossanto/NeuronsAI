CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_at_idx" ON "webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "login_attempts_expires_at_idx" ON "login_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "desktop_login_attempts_expires_at_idx" ON "desktop_login_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "desktop_login_grants_expires_at_idx" ON "desktop_login_grants" USING btree ("expires_at");