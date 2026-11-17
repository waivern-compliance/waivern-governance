ALTER TYPE "public"."assessment_status" ADD VALUE 'imported';--> statement-breakpoint
ALTER TYPE "public"."import_record_type" ADD VALUE 'assessment';--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "source_history" jsonb;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "source_answers" jsonb;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "imported_outcome" "assessment_status";--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_imported" ON "assessment" USING btree ("organisation_id","import_source_id","external_ref") WHERE "assessment"."import_source_id" is not null and "assessment"."external_ref" is not null;