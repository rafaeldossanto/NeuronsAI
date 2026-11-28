ALTER TABLE "runners" DROP CONSTRAINT "runners_organization_name_unique";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "started_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_organization_owner_name_unique" UNIQUE NULLS NOT DISTINCT("organization_id","owner_user_id","name");