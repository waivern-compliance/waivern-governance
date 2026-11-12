ALTER TYPE "public"."marketing_basis" ADD VALUE 'business_address';--> statement-breakpoint
ALTER TYPE "public"."marketing_basis" ADD VALUE 'not_objected';--> statement-breakpoint
ALTER TYPE "public"."marketing_basis" ADD VALUE 'ndd_screened';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'marketing_ndd_screening' BEFORE 'foi_deadline';--> statement-breakpoint
ALTER TABLE "digital_property" ADD COLUMN "processing_activity_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_activity" ADD COLUMN "ndd_screened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_activity" ADD COLUMN "call_numbers" text;--> statement-breakpoint
ALTER TABLE "marketing_activity" ADD COLUMN "in_service_texts" boolean;--> statement-breakpoint
ALTER TABLE "marketing_decision" ADD COLUMN "law" text DEFAULT 'uk' NOT NULL;--> statement-breakpoint
ALTER TABLE "digital_property" ADD CONSTRAINT "digital_property_processing_activity_id_processing_activity_id_fk" FOREIGN KEY ("processing_activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE set null ON UPDATE no action;