CREATE TABLE "graph_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"graph_id" uuid NOT NULL,
	"organization_id" uuid,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_deletion_requests_status_check" CHECK ("graph_deletion_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "graph_deletion_requests" ADD CONSTRAINT "graph_deletion_requests_graph_id_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_deletion_requests" ADD CONSTRAINT "graph_deletion_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_deletion_requests" ADD CONSTRAINT "graph_deletion_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_deletion_requests" ADD CONSTRAINT "graph_deletion_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_deletion_requests_pending_unique" ON "graph_deletion_requests" USING btree ("graph_id") WHERE "graph_deletion_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "graph_deletion_requests_organization_idx" ON "graph_deletion_requests" USING btree ("organization_id");