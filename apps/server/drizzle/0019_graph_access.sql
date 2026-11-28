CREATE TABLE "graph_access" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"graph_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"level" text,
	"requested_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_access_graph_user_unique" UNIQUE("graph_id","user_id"),
	CONSTRAINT "graph_access_status_check" CHECK ("graph_access"."status" in ('granted', 'blocked', 'requested')),
	CONSTRAINT "graph_access_level_check" CHECK ("graph_access"."level" in ('use', 'edit')),
	CONSTRAINT "graph_access_level_matches_status_check" CHECK (("graph_access"."status" = 'granted') = ("graph_access"."level" is not null))
);
--> statement-breakpoint
ALTER TABLE "graphs" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "graphs" ADD COLUMN "access_mode" text DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "graph_access" ADD CONSTRAINT "graph_access_graph_id_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_access" ADD CONSTRAINT "graph_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_access" ADD CONSTRAINT "graph_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_access" ADD CONSTRAINT "graph_access_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_access_organization_user_idx" ON "graph_access" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "graph_access_graph_status_idx" ON "graph_access" USING btree ("graph_id","status");--> statement-breakpoint
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_access_mode_check" CHECK ("graphs"."access_mode" in ('organization', 'restricted'));