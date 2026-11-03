CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "runners_name_unique" UNIQUE("name"),
	CONSTRAINT "runners_token_hash_unique" UNIQUE("token_hash")
);
