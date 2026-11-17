ALTER TYPE "public"."import_record_type" ADD VALUE 'information_asset';--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "links" jsonb;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "information_asset_imported" ON "information_asset" USING btree ("organisation_id","import_source_id","external_ref") WHERE "information_asset"."import_source_id" is not null and "information_asset"."external_ref" is not null;