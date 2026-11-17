CREATE TABLE "asset_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"has_expiry" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information_asset_contract" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	CONSTRAINT "information_asset_contract_asset_id_contract_id_pk" PRIMARY KEY("asset_id","contract_id")
);
--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "notice_days" integer;--> statement-breakpoint
ALTER TABLE "information_asset" ADD COLUMN "auto_renews" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_contract" ADD CONSTRAINT "information_asset_contract_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_contract" ADD CONSTRAINT "information_asset_contract_asset_id_information_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."information_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_asset_contract" ADD CONSTRAINT "information_asset_contract_contract_id_supplier_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."supplier_contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_type_key" ON "asset_type" USING btree ("organisation_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_type_label" ON "asset_type" USING btree ("organisation_id","label");--> statement-breakpoint
CREATE INDEX "information_asset_contract_idx" ON "information_asset_contract" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "information_asset_type_idx" ON "information_asset" USING btree ("organisation_id","asset_type");--> statement-breakpoint
CREATE INDEX "information_asset_expiry_idx" ON "information_asset" USING btree ("organisation_id","expires_at");