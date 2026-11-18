ALTER TYPE "public"."import_record_type" ADD VALUE 'data_protection_complaint';--> statement-breakpoint
ALTER TABLE "data_protection_complaint_event" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_protection_complaint_event" ADD CONSTRAINT "data_protection_complaint_event_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD CONSTRAINT "data_protection_complaint_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD CONSTRAINT "data_protection_complaint_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_protection_complaint_imported" ON "data_protection_complaint" USING btree ("organisation_id","import_source_id","external_ref") WHERE "data_protection_complaint"."import_source_id" is not null and "data_protection_complaint"."external_ref" is not null;