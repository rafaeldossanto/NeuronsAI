ALTER TABLE "runners" DROP CONSTRAINT "runners_name_unique";--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_organization_name_unique" UNIQUE NULLS NOT DISTINCT("organization_id","name");