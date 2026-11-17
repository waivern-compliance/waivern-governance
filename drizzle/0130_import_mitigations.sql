ALTER TYPE "public"."import_record_type" ADD VALUE 'mitigation';--> statement-breakpoint
ALTER TABLE "mitigation" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "mitigation" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "mitigation" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "mitigation" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "mitigation" ADD COLUMN "source_history" jsonb;--> statement-breakpoint
ALTER TABLE "mitigation" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mitigation" ADD CONSTRAINT "mitigation_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mitigation" ADD CONSTRAINT "mitigation_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mitigation_imported" ON "mitigation" USING btree ("import_source_id","external_ref") WHERE "mitigation"."import_source_id" is not null and "mitigation"."external_ref" is not null;