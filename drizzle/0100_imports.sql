CREATE TYPE "public"."import_batch_status" AS ENUM('uploaded', 'previewed', 'committed', 'undone');--> statement-breakpoint
CREATE TYPE "public"."import_record_type" AS ENUM('supplier', 'processing_activity');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('create', 'update', 'merge', 'refuse', 'skip');--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"record_type" "import_record_type" NOT NULL,
	"entity_id" uuid,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"file" "bytea" NOT NULL,
	"columns" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"mapping" jsonb,
	"status" "import_batch_status" DEFAULT 'uploaded' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_by_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by_label" text,
	"undone_at" timestamp with time zone,
	"undone_by_label" text
);
--> statement-breakpoint
CREATE TABLE "import_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"record_type" "import_record_type" NOT NULL,
	"mapping" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"source_ref" text,
	"action" "import_row_action" NOT NULL,
	"reason" text,
	"record" jsonb,
	"record_id" uuid,
	"before" jsonb
);
--> statement-breakpoint
CREATE TABLE "import_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "import_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_source_id_import_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."import_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_source_id_import_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."import_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_source" ADD CONSTRAINT "import_source_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_org_idx" ON "import_batch" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mapping_key" ON "import_mapping" USING btree ("organisation_id","source_id","record_type");--> statement-breakpoint
CREATE INDEX "import_row_batch_idx" ON "import_row" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "import_source_name_key" ON "import_source" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
ALTER TABLE "processing_activity" ADD CONSTRAINT "processing_activity_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD CONSTRAINT "processing_activity_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_import_source_id_import_source_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processing_activity_imported" ON "processing_activity" USING btree ("organisation_id","import_source_id","external_ref") WHERE "processing_activity"."import_source_id" is not null and "processing_activity"."external_ref" is not null;--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "import_source" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_source"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "import_batch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_batch"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "import_row" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_row"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "import_mapping" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_mapping"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
