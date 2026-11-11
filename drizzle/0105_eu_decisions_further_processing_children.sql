ALTER TABLE "processing_activity" ADD COLUMN "adm_eu_exception" text;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "adm_eu_law_note" text;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "eu_compatibility_route" text;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "eu_compatibility_note" text;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "children_member_states" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "adm_eu_exception" text;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "adm_eu_law_note" text;