-- The name-only primary key becomes a surrogate key; NULL retains the existing local workspace.
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_pkey";--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_organization_name_unique" UNIQUE NULLS NOT DISTINCT("organization_id","name");
