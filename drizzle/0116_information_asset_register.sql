ALTER TYPE "public"."record_type" ADD VALUE 'information_asset';--> statement-breakpoint
CREATE TABLE "information_asset_activity" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	CONSTRAINT "information_asset_activity_asset_id_activity_id_pk" PRIMARY KEY("asset_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "information_asset_risk" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "information_asset_risk_asset_id_risk_id_pk" PRIMARY KEY("asset_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "information_asset_supplier" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "information_asset_supplier_asset_id_supplier_id_pk" PRIMARY KEY("asset_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "information_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"asset_type" text NOT NULL,
	"owner_id" uuid,
	"hosting" text,
	"hosted_by" text,
	"region" text,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classification" text,
	"retention" text,
	"next_review_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "asset_classification_scheme" text DEFAULT 'neutral' NOT NULL;--> statement-breakpoint
ALTER TABLE "information_asset_activity" ADD CONSTRAINT "information_asset_activity_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_activity" ADD CONSTRAINT "information_asset_activity_asset_id_information_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."information_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_activity" ADD CONSTRAINT "information_asset_activity_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_risk" ADD CONSTRAINT "information_asset_risk_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_risk" ADD CONSTRAINT "information_asset_risk_asset_id_information_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."information_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_risk" ADD CONSTRAINT "information_asset_risk_risk_id_risk_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_supplier" ADD CONSTRAINT "information_asset_supplier_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_supplier" ADD CONSTRAINT "information_asset_supplier_asset_id_information_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."information_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_supplier" ADD CONSTRAINT "information_asset_supplier_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "information_asset_activity_idx" ON "information_asset_activity" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "information_asset_risk_idx" ON "information_asset_risk" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "information_asset_supplier_idx" ON "information_asset_supplier" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "information_asset_reference" ON "information_asset" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE INDEX "information_asset_entity_idx" ON "information_asset" USING btree ("organisation_id","entity_id");--> statement-breakpoint
CREATE INDEX "information_asset_review_idx" ON "information_asset" USING btree ("organisation_id","next_review_at");