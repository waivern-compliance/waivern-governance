ALTER TYPE "public"."import_record_type" ADD VALUE 'risk';--> statement-breakpoint
ALTER TABLE "risk" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "risk" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "risk" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "risk" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "risk" ADD COLUMN "source_history" jsonb;--> statement-breakpoint
ALTER TABLE "risk" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risk" ADD CONSTRAINT "risk_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk" ADD CONSTRAINT "risk_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_imported" ON "risk" USING btree ("organisation_id","import_source_id","external_ref") WHERE "risk"."import_source_id" is not null and "risk"."external_ref" is not null;