ALTER TABLE "organisation" ADD COLUMN "supplier_review_months" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "next_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "review_outcome" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "review_conditions" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "review_assessment_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_review_assessment_id_assessment_id_fk" FOREIGN KEY ("review_assessment_id") REFERENCES "public"."assessment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_review_idx" ON "supplier" USING btree ("organisation_id","next_review_at");