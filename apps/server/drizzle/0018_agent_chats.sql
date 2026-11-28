ALTER TABLE "messages" ADD COLUMN "chat" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "chat_agent_id" text;--> statement-breakpoint
CREATE INDEX "runs_chat_agent_id_idx" ON "runs" USING btree ("chat_agent_id","graph_version_id") WHERE "runs"."chat_agent_id" is not null;