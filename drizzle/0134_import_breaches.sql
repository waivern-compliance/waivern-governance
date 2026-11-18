ALTER TYPE "public"."import_record_type" ADD VALUE 'breach';--> statement-breakpoint
ALTER TABLE "breach_decision" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "breach_decision" ADD CONSTRAINT "breach_decision_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach" ADD CONSTRAINT "breach_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach" ADD CONSTRAINT "breach_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "breach_imported" ON "breach" USING btree ("organisation_id","import_source_id","external_ref") WHERE "breach"."import_source_id" is not null and "breach"."external_ref" is not null;