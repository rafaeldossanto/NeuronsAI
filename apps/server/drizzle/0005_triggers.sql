CREATE TABLE "graph_triggers" (
	"graph_id" uuid NOT NULL,
	"trigger_id" text NOT NULL,
	"hook_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"secret_set_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"last_outcome" text,
	"last_note" text,
	"last_run_id" uuid,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_triggers_graph_id_trigger_id_pk" PRIMARY KEY("graph_id","trigger_id"),
	CONSTRAINT "graph_triggers_hook_id_unique" UNIQUE("hook_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"hook_id" text NOT NULL,
	"signature" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "webhook_deliveries_hook_id_signature_pk" PRIMARY KEY("hook_id","signature")
);
--> statement-breakpoint
ALTER TABLE "graph_triggers" ADD CONSTRAINT "graph_triggers_graph_id_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_triggers" ADD CONSTRAINT "graph_triggers_last_run_id_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;