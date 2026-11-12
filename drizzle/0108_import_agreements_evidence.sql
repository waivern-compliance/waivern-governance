ALTER TYPE "public"."import_record_type" ADD VALUE 'dpa';--> statement-breakpoint
ALTER TYPE "public"."import_record_type" ADD VALUE 'evidence';--> statement-breakpoint
ALTER TYPE "public"."import_record_type" ADD VALUE 'ai_use_case';--> statement-breakpoint
CREATE TABLE "import_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"scanned_at" timestamp with time zone,
	"scanner_version" text,
	"added_by_label" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dpa" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "dpa" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "dpa" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "dpa" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "link_id" uuid;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_file_name_key" ON "import_file" USING btree ("batch_id",lower("filename"));--> statement-breakpoint
ALTER TABLE "dpa" ADD CONSTRAINT "dpa_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpa" ADD CONSTRAINT "dpa_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD CONSTRAINT "ai_use_case_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_use_case" ADD CONSTRAINT "ai_use_case_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dpa_imported" ON "dpa" USING btree ("organisation_id","import_source_id","external_ref") WHERE "dpa"."import_source_id" is not null and "dpa"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_imported" ON "evidence" USING btree ("organisation_id","import_source_id","external_ref") WHERE "evidence"."import_source_id" is not null and "evidence"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_use_case_imported" ON "ai_use_case" USING btree ("organisation_id","import_source_id","external_ref") WHERE "ai_use_case"."import_source_id" is not null and "ai_use_case"."external_ref" is not null;--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "import_file" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_file"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
