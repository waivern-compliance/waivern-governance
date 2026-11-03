CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"place" text NOT NULL,
	"place_label" text NOT NULL,
	"contact_email" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
-- No organisation's work may read feedback; the platform reads it as the owner.
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
