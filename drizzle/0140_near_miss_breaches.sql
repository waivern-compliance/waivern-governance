ALTER TABLE "breach" ADD COLUMN "classification" text DEFAULT 'breach' NOT NULL;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "aware_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "reclassified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "reclassification_rationale" text;