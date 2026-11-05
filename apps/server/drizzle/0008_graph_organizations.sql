ALTER TABLE "graphs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graphs_organization_idx" ON "graphs" USING btree ("organization_id");