ALTER TYPE "public"."import_record_type" ADD VALUE 'policy_document';--> statement-breakpoint
ALTER TYPE "public"."import_record_type" ADD VALUE 'policy';--> statement-breakpoint
ALTER TABLE "policy_document" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "policy_document" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_document" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_document" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "policy_document" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "source_history" jsonb;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_document" ADD CONSTRAINT "policy_document_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_document" ADD CONSTRAINT "policy_document_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_document_imported" ON "policy_document" USING btree ("organisation_id","import_source_id","external_ref") WHERE "policy_document"."import_source_id" is not null and "policy_document"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_imported" ON "policy" USING btree ("organisation_id","import_source_id","external_ref") WHERE "policy"."import_source_id" is not null and "policy"."external_ref" is not null;