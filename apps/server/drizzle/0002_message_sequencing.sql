ALTER TABLE "messages" ADD COLUMN "seq" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "last_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_seq_unique" UNIQUE("run_id","seq");