ALTER TYPE "public"."import_record_type" ADD VALUE 'information_request';--> statement-breakpoint
ALTER TABLE "information_request_decision" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "information_request_review" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "information_request_decision" ADD CONSTRAINT "information_request_decision_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_review" ADD CONSTRAINT "information_request_review_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "information_request_imported" ON "information_request" USING btree ("organisation_id","import_source_id","external_ref") WHERE "information_request"."import_source_id" is not null and "information_request"."external_ref" is not null;