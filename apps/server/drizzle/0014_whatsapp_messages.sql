CREATE TABLE "whatsapp_messages" (
	"hook_id" text NOT NULL,
	"message_id" text NOT NULL,
	"run_id" uuid,
	"phone_number_id" text NOT NULL,
	"contact" text,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "whatsapp_messages_hook_id_message_id_pk" PRIMARY KEY("hook_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_hook_id_graph_triggers_hook_id_fk" FOREIGN KEY ("hook_id") REFERENCES "public"."graph_triggers"("hook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_run_idx" ON "whatsapp_messages" USING btree ("run_id");